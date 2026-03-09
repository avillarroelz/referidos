const { randomUUID } = require('crypto');
module.exports = () => (req, res, next) => {
  req.reqId = randomUUID().slice(0, 8);
  const t0 = Date.now();
  console.log(`[REQ ${req.reqId}] ${req.method} ${req.originalUrl}`);
  if (req.method !== 'GET') console.log(`[REQ ${req.reqId}] body=`, req.body);
  res.on('finish', () => console.log(`[RES ${req.reqId}] ${res.statusCode} (${Date.now() - t0}ms)`));
  next();
};
