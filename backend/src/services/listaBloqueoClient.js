// backend/src/services/listaBloqueoClient.js
// Cliente de black (lista de no recontratación de Ecora).
// Privacidad: solo se lee `bloqueado` (nunca nombre ni motivo) y ningún error
// lleva el RUT, la URL con el RUT ni la clave: los mensajes son fijos.

const { config } = require('../config')

const TIMEOUT_MS = 5000
const HUELLA_RE = /^[0-9a-f]{64}$/

class ListaBloqueoError extends Error {
  constructor(tipo) {
    super(`Falla en la consulta a la lista de no recontratación (${tipo})`)
    this.name = 'ListaBloqueoError'
    this.tipo = tipo
  }
}

function cfg() {
  return config.listaBloqueo || {}
}

function baseUrl() {
  return String(cfg().url || '').replace(/\/+$/, '')
}

async function pedir(url) {
  let res
  try {
    res = await fetch(url, {
      headers: { 'X-API-Key': cfg().apiKey },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    // El mensaje original puede traer la URL (con el RUT): no se propaga.
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    throw new ListaBloqueoError(timeout ? 'timeout' : 'red')
  }
  if (res.status !== 200) {
    // Sin leer el cuerpo la conexión queda retenida hasta el GC
    try { await res.body?.cancel() } catch { /* ya cerrado */ }
    throw new ListaBloqueoError(`http_${res.status}`)
  }
  try {
    return await res.json()
  } catch {
    throw new ListaBloqueoError('json_invalido')
  }
}

// Devuelve SOLO { bloqueado }. Cualquier otra cosa lanza ListaBloqueoError.
async function consultarRut(rutNormalizado) {
  const cuerpo = await pedir(`${baseUrl()}/${encodeURIComponent(rutNormalizado)}`)
  if (typeof cuerpo?.bloqueado !== 'boolean') throw new ListaBloqueoError('respuesta_inesperada')
  return { bloqueado: cuerpo.bloqueado }
}

// Devuelve string[] de huellas HMAC; exige que cada una calce con /^[0-9a-f]{64}$/.
async function listarHuellas() {
  const cuerpo = await pedir(baseUrl())
  const huellas = cuerpo?.huellas
  if (!Array.isArray(huellas) || !huellas.every(h => typeof h === 'string' && HUELLA_RE.test(h))) {
    throw new ListaBloqueoError('respuesta_inesperada')
  }
  return huellas
}

// http solo se tolera hacia la propia máquina y fuera de producción.
function estaConfigurado() {
  const url = baseUrl()
  if (!url || !cfg().apiKey) return false
  if (/^https:\/\//i.test(url)) return true
  return !config.isProd && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)
}

module.exports = { consultarRut, listarHuellas, estaConfigurado, ListaBloqueoError }
