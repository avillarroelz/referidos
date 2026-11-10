//! Extracción de imágenes: DCT → jpeg tal cual; Flate/raw 8 bits Gray|RGB → png. Lo demás se omite.
use crate::Image;
use base64::{Engine, engine::general_purpose::STANDARD};
use lopdf::{Document, Object};

pub const MAX_IMAGES: usize = 100;

/// Devuelve las imágenes (máx. `MAX_IMAGES`) y si hubo más que se descartaron.
/// `max_stream` acota lo que puede inflarse cada imagen al decodificarla.
pub fn extract_images(doc: &Document, max_stream: usize) -> (Vec<Image>, bool) {
    let mut images = vec![];
    for (page_no, page_id) in doc.get_pages() {
        let Ok(found) = doc.get_page_images(page_id) else { continue };
        for pdf_image in found {
            let Some(image) = convert(doc, page_no, &pdf_image, max_stream) else { continue };
            if images.len() == MAX_IMAGES {
                return (images, true);
            }
            images.push(image);
        }
    }
    (images, false)
}

fn convert(doc: &Document, page: u32, img: &lopdf::xobject::PdfImage, max_stream: usize) -> Option<Image> {
    let width = u32::try_from(img.width).ok().filter(|w| *w > 0)?;
    let height = u32::try_from(img.height).ok().filter(|h| *h > 0)?;
    let filters: Vec<&str> = img.filters.iter().flatten().map(String::as_str).collect();

    let (format, bytes) = match filters.as_slice() {
        ["DCTDecode"] => ("jpeg", img.content.to_vec()),
        [] | ["FlateDecode"] => ("png", encode_png(doc, img, width, height, max_stream)?),
        _ => return None,
    };
    Some(Image { page, width, height, format, data_base64: STANDARD.encode(bytes) })
}

fn encode_png(doc: &Document, img: &lopdf::xobject::PdfImage, width: u32, height: u32, max_stream: usize) -> Option<Vec<u8>> {
    if img.bits_per_component != Some(8) {
        return None;
    }
    let (color, channels) = match img.color_space.as_deref() {
        Some("DeviceRGB") => (png::ColorType::Rgb, 3),
        Some("DeviceGray") => (png::ColorType::Grayscale, 1),
        _ => return None,
    };
    let stream = match doc.get_object(img.id).ok()? {
        Object::Stream(s) => s,
        _ => return None,
    };
    let pixels = stream.decompressed_content_with_limit(max_stream).ok()?;
    let expected = (width as usize).checked_mul(height as usize)?.checked_mul(channels)?;
    if pixels.len() != expected {
        return None;
    }
    let mut out = vec![];
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header().ok()?.write_image_data(&pixels).ok()?;
    Some(out)
}
