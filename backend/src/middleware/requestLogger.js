const { randomUUID } = require('crypto');

// Campos sensibles que NUNCA deben aparecer en logs
const REDACTED_FIELDS = ['password', 'refreshToken', 'accessToken', 'token', 'secret', 'apiKey']

function redactBody(body) {
  if (!body || typeof body !== 'object') return body
  const safe = { ...body }
  for (const key of REDACTED_FIELDS) {
    if (key in safe) safe[key] = '[REDACTED]'
  }
  return safe
}

module.exports = () => (req, res, next) => {
  req.reqId = randomUUID().slice(0, 8);
  const t0 = Date.now();
  console.log(`[REQ ${req.reqId}] ${req.method} ${req.originalUrl}`);
  if (req.method !== 'GET') console.log(`[REQ ${req.reqId}] body=`, redactBody(req.body));
  res.on('finish', () => console.log(`[RES ${req.reqId}] ${res.statusCode} (${Date.now() - t0}ms)`));
  next();
};
