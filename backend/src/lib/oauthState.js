// backend/src/lib/oauthState.js
// Parametro `state` del flujo OAuth: firmado y atado al navegador que lo pidio.
//
// Dos protecciones distintas, y hacen falta las dos:
//
//  1. FIRMA HMAC. Impide fabricar un state. Sin ella, cualquiera compone el
//     contenido que quiera y el callback se lo cree.
//
//  2. NONCE CONTRA COOKIE. Impide reutilizar un state ajeno. La firma sola no
//     alcanza: el atacante inicia SU propio login, recibe un state legitimamente
//     firmado, y lo usa para el ataque. Solo comparando el nonce contra una
//     cookie del navegador se distingue "esta vuelta la pidio este navegador".
//
// El antecedente a no repetir es el callback de Gmail, donde el state se
// decodifica pero no se verifica y el catch no lleva return, asi que el flujo
// continua igual con un state invalido.

const crypto = require('crypto')
const { config } = require('../config')

const COOKIE_STATE = '__oauth_state'
const VIGENCIA_MS = 10 * 60 * 1000

// SameSite 'lax' y no 'strict' a proposito: el callback llega como navegacion
// desde accounts.google.com, y una cookie 'strict' NO se enviaria en una
// peticion que viene de otro sitio. 'lax' si viaja en una navegacion GET de
// nivel superior, que es exactamente este caso, y sigue sin viajar en peticiones
// de terceros iniciadas por script.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'lax',
  path: '/',
  maxAge: VIGENCIA_MS,
}

const firmar = (datos) =>
  crypto.createHmac('sha256', config.jwt.secret).update(datos).digest('base64url')

/**
 * Crea el state y deja en la respuesta la cookie que lo ata a este navegador.
 * Devuelve el valor a incluir en la URL de autorizacion.
 */
function emitirState(res, extra = {}) {
  const nonce = crypto.randomBytes(32).toString('base64url')
  const datos = Buffer.from(JSON.stringify({ ...extra, nonce, ts: Date.now() })).toString('base64url')
  const state = `${datos}.${firmar(datos)}`

  res.cookie(COOKIE_STATE, nonce, COOKIE_OPTS)
  return state
}

/**
 * Verifica firma, vigencia y correspondencia con la cookie del navegador.
 * Devuelve el contenido del state si las tres condiciones se cumplen, y null en
 * cualquier otro caso. Devolver el contenido permite al llamador leer lo que
 * puso al emitirlo —por ejemplo quien inicio el flujo— sabiendo que viene
 * firmado y no de la mano de quien llama.
 */
function verificarState(req, state) {
  if (!state || typeof state !== 'string') return null

  const [datos, firma] = state.split('.')
  if (!datos || !firma) return null

  const esperada = firmar(datos)
  // Comparacion en tiempo constante; timingSafeEqual exige la misma longitud.
  const a = Buffer.from(firma)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  let contenido
  try {
    contenido = JSON.parse(Buffer.from(datos, 'base64url').toString())
  } catch {
    return null
  }

  if (!contenido?.ts || Date.now() - contenido.ts > VIGENCIA_MS) return null

  const nonceDelNavegador = req.cookies?.[COOKIE_STATE]
  if (!nonceDelNavegador || nonceDelNavegador !== contenido.nonce) return null

  return contenido
}

/** El state es de un solo uso: la cookie se retira al consumirlo. */
function limpiarState(res) {
  res.clearCookie(COOKIE_STATE, { ...COOKIE_OPTS, maxAge: undefined })
}

module.exports = { emitirState, verificarState, limpiarState, COOKIE_STATE }
