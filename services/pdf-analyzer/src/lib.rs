//! Núcleo de análisis de PDF: funciones puras, sin HTTP.
mod images;
mod search;
pub use search::{Match, search};

use lopdf::{DecompressError, Document, LoadOptions, Object};
use serde::Serialize;
use std::time::Instant;

/// Tope de bytes que puede inflarse un stream individual al decodificarlo.
const MAX_STREAM_BYTES: usize = 128 * 1024 * 1024;
/// Tope de bytes inflados sumando todos los streams del documento.
const MAX_TOTAL_INFLATED: usize = 512 * 1024 * 1024;
/// Tope del documento reescrito en la ruta de reparación (los object streams se guardan expandidos).
const MAX_REPAIRED_BYTES: usize = 64 * 1024 * 1024;

/// `Vec` que rechaza escrituras sobre un tope, para no reescribir en memoria un documento enorme.
struct CappedBuffer {
    data: Vec<u8>,
    cap: usize,
}

impl std::io::Write for CappedBuffer {
    fn write(&mut self, chunk: &[u8]) -> std::io::Result<usize> {
        if self.data.len() + chunk.len() > self.cap {
            return Err(std::io::Error::other("documento reescrito sobre el tope"));
        }
        self.data.extend_from_slice(chunk);
        Ok(chunk.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub creation_date: Option<String>,
    pub mod_date: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PageText {
    pub page: u32,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Image {
    pub page: u32,
    pub width: u32,
    pub height: u32,
    pub format: &'static str,
    pub data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub text_ms: f64,
    pub images_ms: f64,
    pub search_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub backend: &'static str,
    pub pages: usize,
    pub metadata: Metadata,
    pub text: Vec<PageText>,
    pub images: Vec<Image>,
    pub images_truncated: bool,
    pub matches: Vec<Match>,
    pub timings: Timings,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AnalyzeError {
    /// El documento no se puede parsear (HTTP 400).
    Parse,
    /// Rechazado por límite de recursos (HTTP 422).
    ResourceLimit,
}

pub fn analyze(bytes: &[u8], q: Option<&str>) -> Result<Analysis, AnalyzeError> {
    analyze_with(bytes, q, true)
}

/// Igual que `analyze`; con `with_images = false` no extrae imágenes (`images` va vacío).
pub fn analyze_with(bytes: &[u8], q: Option<&str>, with_images: bool) -> Result<Analysis, AnalyzeError> {
    let started = Instant::now();
    let options = LoadOptions { max_decompressed_size: Some(MAX_STREAM_BYTES), ..Default::default() };
    // Los eprintln de este archivo dejan la etapa y el tipo de error para diagnosticar un 400;
    // los mensajes de lopdf/pdf-extract describen la estructura del archivo, no su texto.
    let mut doc = Document::load_mem_with_options(bytes, options).map_err(|e| {
        if is_limit_error(&e) {
            AnalyzeError::ResourceLimit
        } else {
            eprintln!("[pdf-analyzer] no se pudo cargar el PDF (lopdf): {e}");
            AnalyzeError::Parse
        }
    })?;
    check_inflation(&doc)?;
    let pages = doc.get_pages().len();

    let text_started = Instant::now();
    let mut raw = match pdf_extract::extract_text_from_mem_by_pages(bytes) {
        Ok(raw) => raw,
        Err(e) => {
            eprintln!("[pdf-analyzer] pdf-extract rechazó el archivo ({pages} páginas): {e}; se reintenta reparado");
            extract_text_repaired(&mut doc, bytes.len())?
        }
    };
    // Garantiza una entrada por página aunque ambas librerías discrepen en el conteo.
    raw.resize(pages, String::new());
    let text: Vec<PageText> = raw
        .into_iter()
        .enumerate()
        .map(|(i, t)| PageText { page: i as u32 + 1, text: t.trim().to_string() })
        .collect();
    let text_ms = ms(text_started);

    let images_started = Instant::now();
    let (images, images_truncated) =
        if with_images { images::extract_images(&doc, MAX_STREAM_BYTES) } else { (Vec::new(), false) };
    let images_ms = ms(images_started);

    let search_started = Instant::now();
    let matches = search(&text, q.unwrap_or(""));
    let search_ms = ms(search_started);

    Ok(Analysis {
        backend: "rust",
        pages,
        metadata: read_metadata(&doc),
        text,
        images,
        images_truncated,
        matches,
        timings: Timings { text_ms, images_ms, search_ms, total_ms: ms(started) },
    })
}

/// pdf-extract usa lopdf 0.42, más estricto que el 0.47 con el que ya se cargó `doc`: rechaza
/// archivos con el final dañado (startxref corrido, basura tras %%EOF, sin %%EOF) que el 0.47 sí
/// abre. Se reescribe el documento ya cargado —sale con xref y trailer correctos— y se reintenta.
/// Si aun así falla, se extrae con lopdf directo: pierde saltos de línea, pero entrega el texto.
fn extract_text_repaired(doc: &mut Document, original_len: usize) -> Result<Vec<String>, AnalyzeError> {
    // Sin clonar el documento: save_to solo ajusta datos de escritura y después solo se lee.
    let mut repaired = CappedBuffer { data: Vec::with_capacity(original_len), cap: MAX_REPAIRED_BYTES };
    if doc.save_to(&mut repaired).is_ok()
        && let Ok(raw) = pdf_extract::extract_text_from_mem_by_pages(&repaired.data)
    {
        return Ok(raw);
    }
    drop(repaired);
    let direct: Vec<String> =
        doc.get_pages().keys().map(|number| doc.extract_text(&[*number]).unwrap_or_default()).collect();
    if direct.iter().all(|text| text.trim().is_empty()) {
        eprintln!("[pdf-analyzer] tampoco se pudo extraer el texto del archivo reparado");
        return Err(AnalyzeError::Parse);
    }
    Ok(direct)
}

/// `%PDF-` debe aparecer dentro de los primeros 1024 bytes.
pub fn has_pdf_magic(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(1024)].windows(5).any(|w| w == b"%PDF-")
}

/// Recorre todos los streams con filtro y rechaza el documento si alguno se infla sobre
/// `MAX_STREAM_BYTES` o si el total supera `MAX_TOTAL_INFLATED`. Se hace antes de pdf-extract,
/// que descomprime sin límite (usa lopdf 0.42).
fn check_inflation(doc: &Document) -> Result<(), AnalyzeError> {
    let mut total = 0usize;
    for object in doc.objects.values() {
        let Object::Stream(stream) = object else { continue };
        if stream.filters().is_err() {
            continue; // sin filtro: ya está en memoria tal cual
        }
        match stream.decompressed_content_with_limit(MAX_STREAM_BYTES) {
            Ok(data) => {
                total += data.len();
                if total > MAX_TOTAL_INFLATED {
                    return Err(AnalyzeError::ResourceLimit);
                }
            }
            Err(e) if is_limit_error(&e) => return Err(AnalyzeError::ResourceLimit),
            Err(_) => {} // filtro no soportado o dato dañado: no es un problema de recursos
        }
    }
    Ok(())
}

fn is_limit_error(e: &lopdf::Error) -> bool {
    matches!(e, lopdf::Error::Decompress(DecompressError::MemoryLimitExceeded { .. }))
}

fn ms(since: Instant) -> f64 {
    since.elapsed().as_secs_f64() * 1000.0
}

/// Lee el diccionario Info del trailer; los strings van tal cual (fechas `D:...` incluidas).
fn read_metadata(doc: &Document) -> Metadata {
    let Ok(info) = doc.trailer.get_deref(b"Info", doc).and_then(|o| o.as_dict()) else {
        return Metadata::default();
    };
    let field = |key: &[u8]| {
        info.get_deref(key, doc)
            .and_then(|o| o.as_str())
            .ok()
            .map(pdf_string)
    };
    Metadata {
        title: field(b"Title"),
        author: field(b"Author"),
        creator: field(b"Creator"),
        producer: field(b"Producer"),
        creation_date: field(b"CreationDate"),
        mod_date: field(b"ModDate"),
    }
}

/// Decodifica un text string de PDF: UTF-16BE con BOM, UTF-8, o Latin-1 como último recurso.
fn pdf_string(bytes: &[u8]) -> String {
    if let Some(be) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = be.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&units);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::pdf_string;

    #[test]
    fn pdf_string_decodifica_utf16_utf8_y_latin1() {
        assert_eq!(pdf_string(&[0xFE, 0xFF, 0x00, 0x48, 0x00, 0xE9]), "Hé");
        assert_eq!(pdf_string("ñandú".as_bytes()), "ñandú");
        assert_eq!(pdf_string(&[0x48, 0xE9]), "Hé");
    }
}
