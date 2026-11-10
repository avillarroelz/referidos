//! Búsqueda literal, insensible a mayúsculas, con offsets en code points.
use crate::PageText;
use serde::Serialize;

const SNIPPET_CONTEXT: usize = 40;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Match {
    pub page: u32,
    pub offset: usize,
    pub snippet: String,
}

pub fn search(pages: &[PageText], query: &str) -> Vec<Match> {
    let needle: Vec<char> = query.chars().collect();
    if needle.is_empty() {
        return vec![];
    }
    let mut found = vec![];
    for p in pages {
        let hay: Vec<char> = p.text.chars().collect();
        let mut i = 0;
        while i + needle.len() <= hay.len() {
            if hay[i..i + needle.len()].iter().zip(&needle).all(|(a, b)| same_char(*a, *b)) {
                let from = i.saturating_sub(SNIPPET_CONTEXT);
                let to = (i + needle.len() + SNIPPET_CONTEXT).min(hay.len());
                found.push(Match { page: p.page, offset: i, snippet: hay[from..to].iter().collect() });
                i += needle.len();
            } else {
                i += 1;
            }
        }
    }
    found
}

/// Comparación por code point sin pasar por `to_lowercase` de la cadena completa:
/// así los offsets nunca se desfasan (p. ej. `İ` se expande al minusculizar).
fn same_char(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(n: u32, text: &str) -> PageText {
        PageText { page: n, text: text.to_string() }
    }

    #[test]
    fn encuentra_sin_distinguir_mayusculas_y_da_offset_en_code_points() {
        let m = search(&[page(1, "nada"), page(2, "ñandú come Spanner hoy")], "sPaNnEr");
        assert_eq!(m.len(), 1);
        assert_eq!((m[0].page, m[0].offset), (2, 11));
        assert_eq!(m[0].snippet, "ñandú come Spanner hoy");
    }

    #[test]
    fn query_vacia_no_produce_coincidencias() {
        assert!(search(&[page(1, "abc")], "").is_empty());
    }

    #[test]
    fn es_literal_no_regex() {
        assert!(search(&[page(1, "mundo abc")], "mundo.*(").is_empty());
        assert_eq!(search(&[page(1, "a.c abc")], "a.c").len(), 1);
    }

    #[test]
    fn snippet_recorta_40_caracteres_a_cada_lado() {
        let text = format!("{}X{}", "a".repeat(100), "b".repeat(100));
        let m = search(&[page(1, &text)], "x");
        assert_eq!(m[0].offset, 100);
        assert_eq!(m[0].snippet, format!("{}X{}", "a".repeat(40), "b".repeat(40)));
    }

    #[test]
    fn varias_coincidencias_en_una_pagina() {
        let m = search(&[page(1, "ab ab AB")], "ab");
        assert_eq!(m.iter().map(|x| x.offset).collect::<Vec<_>>(), vec![0, 3, 6]);
    }
}
