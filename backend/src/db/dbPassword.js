// src/db/dbPassword.js
// Clave de la base. Si existe DB_SECRET_ARN se lee de Secrets Manager (la clave rota
// cada 7 días); si no, se usa DB_PASS (dev y tests).
const { config } = require('../config')

let cache = { value: null, at: 0 }
let inflight = null
let smClient = null
let lastForcedRefreshAt = 0

// Con 28P01 persistente no se relee el secreto más de una vez en esta ventana
const FORCED_REFRESH_MIN_MS = 30 * 1000

function getClient() {
  if (!smClient) {
    const { SecretsManagerClient } = require('@aws-sdk/client-secrets-manager')
    smClient = new SecretsManagerClient({ region: config.db.secretRegion })
  }
  return smClient
}

async function fetchSecret() {
  const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')
  const out = await getClient().send(new GetSecretValueCommand({ SecretId: config.db.secretArn }))
  let password
  try {
    ({ password } = JSON.parse(out.SecretString || '{}'))
  } catch {
    // No propagar el error original: su mensaje incluye un fragmento del secreto
    throw new Error('El secreto de la base no es un JSON válido')
  }
  if (!password) throw new Error('El secreto de la base no contiene "password"')
  return password
}

// Devuelve { password, fresh }: fresh=false cuando Secrets Manager falló y se sigue con la anterior
function readSecret() {
  // Una sola lectura en vuelo: el resto de las conexiones espera la misma promesa
  if (!inflight) {
    inflight = fetchSecret()
      .then((password) => {
        cache = { value: password, at: Date.now() }
        return { password, fresh: true }
      })
      .catch((err) => {
        // La clave rota cada 7 días: la anterior casi seguro sigue válida, mejor que quedar sin base.
        // Solo se registra el nombre del error, nunca su mensaje (puede traer datos del secreto).
        if (!cache.value) throw err
        console.warn(`[db] No se pudo leer el secreto de la base (${err.name}); se sigue con la clave anterior`)
        return { password: cache.value, fresh: false }
      })
      .finally(() => { inflight = null })
  }
  return inflight
}

async function getDbPassword() {
  if (!config.db.secretArn) return config.db.pass

  if (cache.value && Date.now() - cache.at < config.db.secretTtlMs) return cache.value

  return (await readSecret()).password
}

function isAuthError(err) {
  const code = err?.parent?.code || err?.original?.code || err?.code
  return code === '28P01'
}

// Clave para reintentar tras un 28P01 con la clave `used`; null si no vale la pena.
async function passwordForRetry(used) {
  if (!config.db.secretArn) return null
  // El caché ya cambió (otra conexión renovó): usarlo, o unirse a la lectura en vuelo
  if (cache.value !== used) return getDbPassword()
  if (Date.now() - lastForcedRefreshAt < FORCED_REFRESH_MIN_MS) return null
  // El caché no se vacía antes de leer: si la lectura falla, las demás conexiones conservan la clave
  const { password, fresh } = await readSecret()
  // Solo una lectura real consume la ventana; un fallo de Secrets Manager no bloquea el próximo intento
  if (!fresh) return null
  lastForcedRefreshAt = Date.now()
  return password === used ? null : password
}

// Envuelve el connect original: ante 28P01 relee la clave y reintenta UNA vez
// (la conexión que topó con la rotación no debe fallar si la clave nueva ya existe)
function withAuthRetry(connect) {
  return async (cfg) => {
    // Se captura antes de conectar: cfg es el objeto compartido de Sequelize y otra conexión
    // puede cambiarle la clave mientras esta espera
    const used = cfg.password
    try {
      return await connect(cfg)
    } catch (err) {
      if (!isAuthError(err)) throw err
      const password = await passwordForRetry(used)
      if (!password) throw err
      cfg.password = password
      return connect(cfg)
    }
  }
}

function _reset() {
  cache = { value: null, at: 0 }
  inflight = null
  smClient = null
  lastForcedRefreshAt = 0
}

module.exports = { getDbPassword, withAuthRetry, _reset }
