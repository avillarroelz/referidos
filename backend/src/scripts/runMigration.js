// backend/src/scripts/runMigration.js
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
require('dotenv').config()

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  } : false
})

async function runMigration() {
  try {
    console.log('🔄 Conectando a la base de datos...')
    const client = await pool.connect()

    console.log('📄 Leyendo archivo de migración...')
    const sqlPath = path.join(__dirname, '..', '..', 'migrations', 'add-google-oauth-columns.sql')
    const sql = fs.readFileSync(sqlPath, 'utf8')

    console.log('⚡ Ejecutando migración...')
    await client.query(sql)

    console.log('✅ Migración completada exitosamente!')
    console.log('')
    console.log('Columnas agregadas a la tabla usuarios:')
    console.log('  - google_id')
    console.log('  - google_refresh_token')
    console.log('  - profile_picture')
    console.log('  - auth_provider')
    console.log('  - password (ahora es nullable)')

    client.release()
    await pool.end()
    process.exit(0)

  } catch (error) {
    console.error('❌ Error ejecutando migración:', error.message)
    await pool.end()
    process.exit(1)
  }
}

runMigration()
