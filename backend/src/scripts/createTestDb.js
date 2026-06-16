// Crea la BD de pruebas (por defecto "referidos_test") en la RDS. Idempotente.
// Se conecta a la base administrativa "postgres" porque no se puede crear una BD
// estando conectado a ella misma. Uso: node src/scripts/createTestDb.js
require('dotenv').config()
const { Client } = require('pg')

const TARGET_DB = process.env.TEST_DB_NAME || 'referidos_test'

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  })

  await client.connect()
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [TARGET_DB])

  if (rowCount > 0) {
    console.log(`La base "${TARGET_DB}" ya existe. Nada que crear.`)
  } else {
    // TARGET_DB es un identificador controlado (no entrada de usuario externa).
    await client.query(`CREATE DATABASE "${TARGET_DB}"`)
    console.log(`Base "${TARGET_DB}" creada correctamente.`)
  }

  await client.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
