// backend/src/scripts/migrate.js
// Ejecuta un archivo SQL de migración (de la carpeta /migrations) pasado por argumento.
// Uso: node src/scripts/migrate.js add-postulante-user-id.sql
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
require('dotenv').config()

const file = process.argv[2]
if (!file) {
  console.error('Uso: node src/scripts/migrate.js <archivo.sql>')
  process.exit(1)
}

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

async function run() {
  try {
    const sqlPath = path.isAbsolute(file)
      ? file
      : path.join(__dirname, '..', '..', 'migrations', file)

    console.log(`📄 Migración: ${sqlPath}`)
    const sql = fs.readFileSync(sqlPath, 'utf8')

    console.log('🔄 Conectando a la base de datos...')
    const client = await pool.connect()

    console.log('⚡ Ejecutando...')
    await client.query(sql)

    console.log('✅ Migración completada exitosamente.')
    client.release()
    await pool.end()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error ejecutando migración:', error.message)
    await pool.end()
    process.exit(1)
  }
}

run()
