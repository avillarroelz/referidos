// backend/src/middleware/errorHandler.js
const { config } = require('../config')

function errorHandler(err, _req, res, _next) {
  console.error('[ERROR]', err)
  const status = err.status || 500

  // En producción, nunca exponer detalles internos
  const message = config.isProd
    ? 'Error interno del servidor'
    : err.message || 'Internal Server Error'

  res.status(status).json({ error: message })
}
module.exports = { errorHandler }
