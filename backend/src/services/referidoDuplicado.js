// backend/src/services/referidoDuplicado.js
// Busca un referido que ya exista con el mismo RUT o correo, sin que cuenten las
// diferencias de escritura (puntos, guion, k/K en el RUT; mayusculas y espacios
// en el correo). Lo usan la vista previa y los dos imports de Gmail.
const { Op, fn, col, where } = require('sequelize')
const { normalizarRut } = require('../lib/rut')

// ── Remitente (`From`) ─────────────────────────────────────────
const MAX_NOMBRE = 100

// Palabras codificadas MIME (RFC 2047) de un display name: `=?UTF-8?Q?Mar=C3=ADa?=`.
// Devuelve null si algun charset o contenido no se puede decodificar.
function decodificarPalabrasMime(texto) {
  let fallo = false
  // Entre dos palabras codificadas contiguas el espacio no cuenta.
  const unido = texto.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?)/g, '$1')
  const resultado = unido.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_m, charset, enc, dato) => {
    try {
      const bytes = enc.toUpperCase() === 'B'
        ? Buffer.from(dato, 'base64')
        : Buffer.from(dato.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1')
      return new TextDecoder(charset, { fatal: true }).decode(bytes)
    } catch {
      fallo = true
      return ''
    }
  })
  return fallo ? null : resultado
}

// Limpia el display name: decodifica MIME, quita `\` y caracteres de control, corta
// a 100 y descarta lo que traiga '@' (suele ser otro correo que suplanta identidad).
function limpiarNombre(crudo) {
  const decodificado = decodificarPalabrasMime(crudo.replace(/^"(.*)"$/, '$1'))
  if (decodificado === null) return ''
  const nombre = decodificado.replace(/[\\\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOMBRE).trim()
  return nombre.includes('@') ? '' : nombre
}

// `"Nombre" <correo>` o solo `correo` -> { nombre, email } (nombre '' si no viene).
// Ambiguo (mas de un <...>, coma fuera de comillas: varios remitentes) -> null.
function parsearRemitente(from) {
  const texto = String(from || '').trim()
  if ((texto.match(/</g) || []).length > 1 || (texto.match(/>/g) || []).length > 1) return null
  if (texto.replace(/"(?:[^"\\]|\\.)*"/g, '').includes(',')) return null
  const conNombre = /^(.*?)<([^<>\s]+@[^<>\s]+)>$/.exec(texto)
  if (conNombre) return { nombre: limpiarNombre(conNombre[1].trim()), email: conNombre[2].toLowerCase() }
  if (/^[^\s<>]+@[^\s<>]+$/.test(texto)) return { nombre: '', email: texto.toLowerCase() }
  return null
}

// Formas en que un RUT puede estar guardado: sin migrar datos viejos.
function variantesDeRut(rutNormalizado) {
  const [cuerpo, dv] = rutNormalizado.split('-')
  const conPuntos = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const variantes = new Set()
  for (const c of [cuerpo, conPuntos]) {
    for (const d of new Set([dv, dv.toLowerCase()])) {
      variantes.add(`${c}-${d}`)
      variantes.add(`${c}${d}`)
    }
  }
  return [...variantes]
}

// Correo en minusculas y si es "de relleno" (salio del remitente, no del postulante).
// Lo decide el servidor: en el analisis por `rellenadoDesdeRemitente`; en el import
// manual por `emailDeRelleno` (el correo coincide con el From del propio item).
// Una consultora que reenvia CVs firma todos con el mismo correo: es una clave DEBIL.
function correoDePersona({ email, rellenadoDesdeRemitente, emailDeRelleno } = {}) {
  const correo = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const debil = emailDeRelleno === true
    || (Array.isArray(rellenadoDesdeRemitente) && rellenadoDesdeRemitente.includes('email'))
  return { correo, debil }
}

// Mayusculas, sin tildes y espacios colapsados: "  María  Pérez " -> "MARIA PEREZ".
function normalizarNombre(nombre) {
  if (typeof nombre !== 'string') return ''
  return nombre.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

// Claves que identifican a una persona dentro de un mismo analisis (RUT normalizado,
// correo en minusculas), para unir correos repetidos. Un RUT con DV invalido entra
// por su texto crudo limpio. Un correo de relleno solo identifica junto al nombre.
function clavesDePersona(datos = {}) {
  const claves = []
  const rutNormalizado = normalizarRut(datos.rut)
  if (rutNormalizado) claves.push(`rut:${rutNormalizado}`)
  else if (typeof datos.rut === 'string' && datos.rut.trim()) {
    claves.push(`rutcrudo:${datos.rut.replace(/[\s.]/g, '').toUpperCase()}`)
  }
  const { correo, debil } = correoDePersona(datos)
  if (correo && !debil) claves.push(`email:${correo}`)
  const nombre = normalizarNombre(datos.nombre)
  if (correo && debil && nombre) claves.push(`emailnombre:${correo}|${nombre}`)
  return claves
}

// Limite conocido: el RUT se busca por variantes de escritura habituales (con/sin
// puntos, con/sin guion, k/K) mas el texto exacto. Variantes raras ya guardadas
// (ceros a la izquierda, espacios internos, guiones tipograficos, puntos parciales)
// no se detectan sin normalizar la columna `referidos.rut` (ver deuda en la tarea ODD).
async function buscarReferidoExistente(datos = {}) {
  const { getModel } = require('../db') // perezoso: gmailService importa este modulo sin base de datos
  const Referido = getModel('Referido')
  const condiciones = []

  if (typeof datos.rut === 'string' && datos.rut.trim()) {
    condiciones.push({ rut: datos.rut.trim() })
    const rutNormalizado = normalizarRut(datos.rut)
    if (rutNormalizado) condiciones.push({ rut: { [Op.in]: variantesDeRut(rutNormalizado) } })
  }

  const { correo, debil } = correoDePersona(datos)
  if (correo && !debil) condiciones.push(where(fn('lower', col('email')), correo))

  if (condiciones.length > 0) {
    const existente = await Referido.findOne({ where: { [Op.or]: condiciones }, attributes: ['id', 'nombre'] })
    if (existente) return { id: existente.id, nombre: existente.nombre }
  }

  // Correo de relleno: candidatos por correo y se confirma por nombre normalizado en JS
  // (quitar tildes en SQL no es portable entre SQLite y Postgres).
  const nombre = normalizarNombre(datos.nombre)
  if (correo && debil && nombre) {
    const candidatos = await Referido.findAll({
      where: where(fn('lower', col('email')), correo),
      attributes: ['id', 'nombre'],
    })
    const coincide = candidatos.find(c => normalizarNombre(c.nombre) === nombre)
    if (coincide) return { id: coincide.id, nombre: coincide.nombre }
  }
  return null
}

module.exports = { buscarReferidoExistente, clavesDePersona, parsearRemitente }
