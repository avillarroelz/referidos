// backend/src/scripts/cleanDuplicateConstraints.js
require('dotenv').config()
const { sequelize } = require('../db')

async function cleanDuplicateConstraints() {
  console.log('🔧 Limpiando constraints duplicados...\n')

  try {
    // Obtener todas las tablas
    const [tables] = await sequelize.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'pg_%'
      ORDER BY table_name;
    `)

    for (const { table_name } of tables) {
      console.log(`📋 Procesando tabla: ${table_name}`)

      // Obtener todos los constraints UNIQUE de la tabla
      const [constraints] = await sequelize.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = '${table_name}'
        AND tc.constraint_type = 'UNIQUE'
        AND tc.table_schema = 'public'
        ORDER BY kcu.column_name, tc.constraint_name;
      `)

      if (constraints.length === 0) {
        console.log(`  ✓ Sin constraints UNIQUE\n`)
        continue
      }

      // Agrupar por columna
      const grouped = {}
      for (const { constraint_name, column_name } of constraints) {
        if (!grouped[column_name]) {
          grouped[column_name] = []
        }
        grouped[column_name].push(constraint_name)
      }

      // Eliminar duplicados (mantener solo el primero)
      for (const [column, constraintNames] of Object.entries(grouped)) {
        if (constraintNames.length > 1) {
          console.log(`  ⚠️  Columna "${column}" tiene ${constraintNames.length} constraints:`)

          // Mantener el primero, eliminar el resto
          const [keep, ...remove] = constraintNames
          console.log(`     ✓ Mantener: ${keep}`)

          for (const constraintName of remove) {
            console.log(`     ❌ Eliminar: ${constraintName}`)
            try {
              await sequelize.query(`
                ALTER TABLE "${table_name}"
                DROP CONSTRAINT IF EXISTS "${constraintName}";
              `)
              console.log(`     ✅ Eliminado: ${constraintName}`)
            } catch (err) {
              console.error(`     ⚠️  Error eliminando ${constraintName}:`, err.message)
            }
          }
        } else {
          console.log(`  ✓ Columna "${column}": ${constraintNames[0]}`)
        }
      }
      console.log()
    }

    console.log('✅ Limpieza completada\n')

    // Mostrar resumen final
    console.log('📊 Resumen de constraints UNIQUE actuales:\n')
    for (const { table_name } of tables) {
      const [constraints] = await sequelize.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = '${table_name}'
        AND tc.constraint_type = 'UNIQUE'
        AND tc.table_schema = 'public'
        ORDER BY kcu.column_name;
      `)

      if (constraints.length > 0) {
        console.log(`  ${table_name}:`)
        for (const { column_name, constraint_name } of constraints) {
          console.log(`    - ${column_name}: ${constraint_name}`)
        }
      }
    }

  } catch (error) {
    console.error('❌ Error durante la limpieza:', error)
    throw error
  } finally {
    await sequelize.close()
  }
}

// Ejecutar
cleanDuplicateConstraints()
  .then(() => {
    console.log('\n✅ Script finalizado exitosamente')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n❌ Script falló:', err)
    process.exit(1)
  })
