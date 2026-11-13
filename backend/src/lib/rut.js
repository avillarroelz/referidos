// backend/src/lib/rut.js
// Normaliza un RUT chileno a `cuerpo-DV` (sin puntos, DV en mayúscula). Debe
// coincidir byte a byte con la forma de black: sobre ella se calcula la huella.

function digitoVerificador(cuerpo) {
  let suma = 0
  let factor = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const dv = 11 - (suma % 11)
  if (dv === 11) return '0'
  if (dv === 10) return 'K'
  return String(dv)
}

// Devuelve '' si no es un RUT consultable (no es string, formato inválido o DV incorrecto).
function normalizarRut(valor) {
  if (typeof valor !== 'string') return ''
  // Espacios y puntos se descartan; los guiones tipográficos (U+2010 a U+2015, U+2212) valen como "-"
  const limpio = valor.replace(/[‐-―−]/g, '-').replace(/[\s.]/g, '')
  const m = /^(\d+)-?([0-9kK])$/.exec(limpio)
  if (!m) return ''
  const cuerpo = m[1].replace(/^0+(?=\d)/, '')
  if (cuerpo.length > 8) return ''
  const dv = m[2].toUpperCase()
  return digitoVerificador(cuerpo) === dv ? `${cuerpo}-${dv}` : ''
}

module.exports = { normalizarRut }
