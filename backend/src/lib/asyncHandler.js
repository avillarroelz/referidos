// backend/src/lib/asyncHandler.js
// Express 4 no captura la promesa rechazada de un handler async: el rechazo se
// va a unhandledRejection, nunca llega al errorHandler y la peticion queda SIN
// RESPUESTA. Cada peticion colgada retiene ademas su conexion del pool, asi que
// un fallo transitorio de base escala a indisponibilidad total del backend.

/** Encadena el rechazo del handler a next(), que es lo que Express 4 no hace. */
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/**
 * Envuelve las funciones de un objeto de exports y deja intacto todo lo demas,
 * porque los controladores exportan handlers junto a arrays de validators.
 *
 * No enumera nombres a proposito: una lista escrita a mano deja sin proteger al
 * handler que alguien agregue mañana, y el fallo seria invisible hasta que la
 * base falle en produccion.
 */
function wrapHandlers(handlers) {
  const envueltos = {}
  for (const [nombre, valor] of Object.entries(handlers)) {
    envueltos[nombre] = typeof valor === 'function' ? asyncHandler(valor) : valor
  }
  return envueltos
}

module.exports = { asyncHandler, wrapHandlers }
