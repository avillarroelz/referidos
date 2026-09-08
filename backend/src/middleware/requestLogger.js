const { randomUUID } = require('crypto');

// Credenciales: se comparan por SUBCADENA, ignorando mayusculas y guiones bajos,
// para cubrir currentPassword, newPassword, refresh_token, access_token, api_key
// y lo que venga despues. Redactar de mas aqui no cuesta nada; de menos es fuga.
const CLAVES_CREDENCIAL = ['password', 'token', 'secret', 'apikey']

// Datos personales: lista EXPLICITA y match exacto. Por subcadena, "nombre"
// tambien se comeria nombreUnidad o nombreLinea, que no describen a una persona
// y si sirven para depurar. Campo personal nuevo → una linea mas aca.
const CAMPOS_PERSONALES = [
  'nombre', 'nombrereferidor', 'rut', 'correo', 'email', 'telefono', 'observaciones',
]

const REDACTADO = '[REDACTED]'

/** Normaliza la clave para comparar credenciales: minusculas y sin separadores. */
function normalizar(key) {
  return key.toLowerCase().replace(/[_-]/g, '')
}

function esSensible(key) {
  const plana = normalizar(key)
  if (CLAVES_CREDENCIAL.some(c => plana.includes(c))) return true
  return CAMPOS_PERSONALES.includes(key.toLowerCase())
}

/**
 * Devuelve una copia del body con los valores sensibles reemplazados, bajando
 * por objetos y arrays. Nunca muta lo recibido: este logger corre antes que los
 * controllers, asi que una mutacion le cambiaria los datos a la aplicacion.
 */
function redactBody(body) {
  if (Array.isArray(body)) return body.map(redactBody)
  if (!body || typeof body !== 'object') return body

  const safe = {}
  for (const [key, value] of Object.entries(body)) {
    safe[key] = esSensible(key) ? REDACTADO : redactBody(value)
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

module.exports.redactBody = redactBody;
