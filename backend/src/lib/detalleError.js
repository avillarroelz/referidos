// backend/src/lib/detalleError.js
// Mismo criterio que el errorHandler central, para los controladores que
// responden por su cuenta y nunca llegan a el.
//
// El mensaje de una excepcion suele traer rutas de archivos, nombres de tabla,
// respuestas de APIs externas o cadenas de conexion. En desarrollo mostrarlo es
// util y deliberado; en produccion es una fuga.

const { config } = require('../config')

/**
 * Detalle a incluir en la respuesta: el mensaje real en desarrollo, y undefined
 * en produccion —undefined, no null, para que JSON.stringify omita la clave y
 * el cliente no reciba `"details": null`, que solo confunde.
 */
function detalleParaCliente(err) {
  if (config.isProd) return undefined
  return err?.message || String(err)
}

/**
 * Variante para cuando el detalle ocupa un campo que siempre debe traer algo,
 * como el resultado por elemento de una sincronizacion: en produccion devuelve
 * el texto generico en vez de desaparecer.
 */
function detalleOGenerico(err, generico = 'Error al procesar') {
  return detalleParaCliente(err) || generico
}

module.exports = { detalleParaCliente, detalleOGenerico }
