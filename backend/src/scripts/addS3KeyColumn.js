// Script para agregar columna s3_key a la tabla documentos
require('dotenv').config()
const { sequelize } = require('../db')

async function migrate() {
  try {
    console.log('🔄 Conectando a la base de datos...')
    await sequelize.authenticate()
    console.log('✅ Conectado')

    console.log('📝 Agregando columna s3_key a documentos...')

    await sequelize.query(`
      ALTER TABLE documentos
      ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500);
    `)

    console.log('✅ Columna s3_key agregada')

    console.log('📝 Creando índice...')

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_documentos_s3_key ON documentos(s3_key);
    `)

    console.log('✅ Índice creado')
    console.log('🎉 Migración completada exitosamente')

    process.exit(0)
  } catch (error) {
    console.error('❌ Error en migración:', error)
    process.exit(1)
  }
}

migrate()
