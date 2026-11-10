use pdf_analyzer::{AnalyzeError, analyze, has_pdf_magic};
use std::path::PathBuf;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name);
    std::fs::read(&path).unwrap_or_else(|_| panic!("falta el fixture {name}; debe estar en template/fixtures"))
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[test]
fn extrae_texto_por_pagina() {
    let a = analyze(&fixture("text.pdf"), None).unwrap();
    assert_eq!(a.pages, 2);
    assert_eq!(a.text.iter().map(|t| t.page).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(norm(&a.text[0].text), "Hola mundo PDF lab");
    assert_eq!(norm(&a.text[1].text), "Segunda pagina con la palabra clave Spanner");
}

#[test]
fn extrae_metadatos_del_info() {
    let a = analyze(&fixture("text.pdf"), None).unwrap();
    let m = &a.metadata;
    assert_eq!(m.title.as_deref(), Some("Fixture de texto"));
    assert_eq!(m.author.as_deref(), Some("pdf-lab"));
    assert_eq!(m.creator.as_deref(), Some("pdf-lab generator"));
    assert_eq!(m.producer.as_deref(), Some("pdf-lab"));
    assert_eq!(m.creation_date.as_deref(), Some("D:20261109120000Z"));
    assert_eq!(m.mod_date.as_deref(), Some("D:20261109120000Z"));
}

#[test]
fn metadatos_ausentes_son_none() {
    let a = analyze(&fixture("image.pdf"), None).unwrap();
    assert!(a.metadata.title.is_none() && a.metadata.mod_date.is_none());
}

#[test]
fn analyze_busca_con_q() {
    let a = analyze(&fixture("text.pdf"), Some("sPaNnEr")).unwrap();
    assert_eq!(a.matches.len(), 1);
    let m = &a.matches[0];
    assert_eq!(m.page, 2);
    let found: String = a.text[1].text.chars().skip(m.offset).take(7).collect();
    assert_eq!(found, "Spanner");
    assert!(analyze(&fixture("text.pdf"), Some("")).unwrap().matches.is_empty());
    assert!(analyze(&fixture("text.pdf"), None).unwrap().matches.is_empty());
}

#[test]
fn trescientas_paginas_con_todas_las_entradas() {
    let a = analyze(&fixture("many-pages.pdf"), Some("pagina 300 ")).unwrap();
    assert_eq!(a.pages, 300);
    assert_eq!(a.text.len(), 300);
    assert_eq!(a.matches.len(), 1);
    assert_eq!(a.matches[0].page, 300);
}

/// Arma un PDF mínimo con xref correcto; `objects[i]` es el objeto i+1 (catálogo=1, páginas=2).
fn build_pdf(objects: &[Vec<u8>]) -> Vec<u8> {
    let mut out = b"%PDF-1.7\n".to_vec();
    let mut offsets = vec![];
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend(format!("{} 0 obj\n", i + 1).bytes());
        out.extend(body);
        out.extend(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for o in offsets {
        out.extend(format!("{o:010} 00000 n \n").bytes());
    }
    out.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
    out
}

fn stream(dict: &str, data: &[u8]) -> Vec<u8> {
    let mut v = format!("<< {dict} /Length {} >>\nstream\n", data.len()).into_bytes();
    v.extend(data);
    v.extend(b"\nendstream");
    v
}

/// PDF de una página con `n` imágenes XObject; `image(i)` da el objeto de la imagen i.
fn pdf_with_images(n: usize, image: impl Fn(usize) -> Vec<u8>) -> Vec<u8> {
    let xobjs: String = (0..n).map(|i| format!("/Im{i} {} 0 R ", i + 4)).collect();
    let mut objs = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << {xobjs}>> >> >>").into_bytes(),
    ];
    objs.extend((0..n).map(image));
    build_pdf(&objs)
}

#[test]
fn extrae_imagen_flate_rgb_como_png_valido() {
    let a = analyze(&fixture("image.pdf"), None).unwrap();
    assert_eq!(a.images.len(), 1);
    assert!(!a.images_truncated);
    let img = &a.images[0];
    assert_eq!((img.page, img.width, img.height, img.format), (1, 8, 8, "png"));
    let bytes = base64_decode(&img.data_base64);
    assert_eq!(&bytes[..4], &[0x89, b'P', b'N', b'G']);
    // Se decodifica de vuelta con el crate png y el primer píxel coincide con el fixture (0, 255, 128).
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    reader.next_frame(&mut buf).unwrap();
    assert_eq!(&buf[..3], &[0, 255, 128]);
}

fn base64_decode(s: &str) -> Vec<u8> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

#[test]
fn imagen_dct_se_entrega_como_jpeg_tal_cual() {
    let fake_jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9];
    let pdf = pdf_with_images(1, |_| {
        stream("/Type /XObject /Subtype /Image /Width 4 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", &fake_jpeg)
    });
    let a = analyze(&pdf, None).unwrap();
    assert_eq!(a.images.len(), 1);
    assert_eq!(a.images[0].format, "jpeg");
    assert_eq!(base64_decode(&a.images[0].data_base64), fake_jpeg);
}

#[test]
fn formato_no_soportado_se_omite() {
    let pdf = pdf_with_images(1, |_| {
        stream("/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode", &[0; 8])
    });
    assert!(analyze(&pdf, None).unwrap().images.is_empty());
}

#[test]
fn mas_de_100_imagenes_se_trunca() {
    let pdf = pdf_with_images(101, |_| {
        stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8", &[0, 64, 128, 255])
    });
    let a = analyze(&pdf, None).unwrap();
    assert_eq!(a.images.len(), 100);
    assert!(a.images_truncated);
}

#[test]
fn pdf_sin_texto_ni_imagenes() {
    let a = analyze(&fixture("empty.pdf"), None).unwrap();
    assert_eq!(a.pages, 1);
    assert_eq!(norm(&a.text[0].text), "");
    assert!(a.images.is_empty());
}

#[test]
fn pdf_corrupto_es_error_de_parseo() {
    assert_eq!(analyze(&fixture("corrupt.pdf"), None).unwrap_err(), AnalyzeError::Parse);
}

#[test]
fn pdf_truncado_se_recupera_o_falla_limpio() {
    // Ambos resultados son válidos según el contrato; lo prohibido es el panic.
    let _ = analyze(&fixture("truncated.pdf"), None);
}

#[test]
fn bomba_de_compresion_es_limite_de_recursos() {
    assert_eq!(analyze(&fixture("bomb.pdf"), None).unwrap_err(), AnalyzeError::ResourceLimit);
}

#[test]
fn detecta_magic_bytes_en_los_primeros_1024() {
    assert!(has_pdf_magic(b"%PDF-1.7\nresto"));
    let mut padded = vec![b' '; 1000];
    padded.extend(b"%PDF-1.4");
    assert!(has_pdf_magic(&padded));
    let mut late = vec![b' '; 1024];
    late.extend(b"%PDF-1.4");
    assert!(!has_pdf_magic(&late));
    assert!(!has_pdf_magic(b"esto no es un pdf"));
}
