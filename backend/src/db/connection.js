// src/db/connection.js
const { Sequelize } = require('sequelize')
const fs = require('fs')
const { config } = require('../config')

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
    }
  }
)

module.exports = { sequelize }
