// backend/src/middleware/errorHandler.js
function errorHandler(err, _req, res, _next) {
  console.error('[ERROR]', err)
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Internal Server Error' })
}
module.exports = { errorHandler }
