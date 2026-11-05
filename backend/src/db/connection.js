// src/db/connection.js
const { Sequelize } = require('sequelize')
const fs = require('fs')
const { config } = require('../config')
const { getDbPassword, withAuthRetry } = require('./dbPassword')

/**
 * Logging por .env:
 *  - DB_LOG=false (default) -> sin log SQL
 *  - DB_LOG=true            -> log SQL con console.log
 *  - DB_LOG=time            -> log SQL + tiempos
 */
function buildLogger() {
  const mode = String(process.env.DB_LOG || 'false').toLowerCase()
  if (mode === 'true') return console.log
  if (mode === 'time') {
    return (sql, timingMs) => {
      if (typeof timingMs === 'number') console.log(`[SQL ${timingMs}ms] ${sql}`)
      else console.log(`[SQL] ${sql}`)
    }
  }
  return false
}

const dialectOptions = {}
if (config.db.ssl) {
  dialectOptions.ssl = {
    require: true,
    rejectUnauthorized: config.db.sslRejectUnauthorized
  }
  if (config.db.sslCaPath) {
    try {
      dialectOptions.ssl.ca = fs.readFileSync(config.db.sslCaPath, 'utf8')
    } catch (e) {
      console.warn('[DB] No se pudo leer DB_SSL_CA:', e.message)
    }
  }
}

const sequelize = new Sequelize(
  config.db.name,
  config.db.user,
  config.db.pass,
  {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres',
    logging: buildLogger(),
    benchmark: String(process.env.DB_LOG || '').toLowerCase() === 'time',
    dialectOptions,
    pool: {
      max: 10,
      min: 0,
      idle: 10000,
      acquire: 30000
    },
    hooks: {
      // Cada conexión nueva del pool toma la clave vigente (cacheada); sin DB_SECRET_ARN es DB_PASS
      beforeConnect: async (cfg) => {
        cfg.password = await getDbPassword()
      }
    }
  }
)

// Si la base rechaza la clave (28P01, p. ej. tras una rotación) se invalida el caché y se
// reintenta una vez. Aquí pasan todas las conexiones, incluido authenticate() del arranque.
const cm = sequelize.connectionManager
cm.connect = withAuthRetry(cm.connect.bind(cm))

module.exports = { sequelize }
