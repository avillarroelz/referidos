// Script para ELIMINAR los usuarios de prueba creados por seedTestUsers.js
// Borra los usuarios con correo test_<rol>@ecora.cl y sus relaciones de rol.
// Uso: node src/scripts/cleanTestUsers.js
const { sequelize } = require('../db/connection')
const { loadModels } = require('../db/loadModels')
const associate = require('../db/associate')
const { Op } = require('sequelize')

const ROLES = ['ADMIN', 'RRHH', 'JefeRRHH', 'TRABAJADOR', 'ADC', 'EXTERNO']
const EMAILS = ROLES.map(r => `test_${r.toLowerCase()}@ecora.cl`)

async function main() {
  await sequelize.authenticate()
  const models = loadModels(sequelize)
  associate(models)
  const Usuario = models.usuario

  const usuarios = await Usuario.findAll({ where: { correo: { [Op.in]: EMAILS } } })

  if (usuarios.length === 0) {
    console.log('No se encontraron usuarios de prueba. Nada que limpiar.')
    await sequelize.close()
    process.exit(0)
  }

  for (const u of usuarios) {
    // Quitar relaciones de rol antes de borrar (evita FK colgantes en usuario_rol)
    await u.setRoles([])
    await u.destroy()
    console.log(`  Eliminado: ${u.correo}`)
  }

  console.log(`\nListo. ${usuarios.length} usuario(s) de prueba eliminado(s).`)
  console.log('Nota: si estos usuarios crearon postulaciones/referidos durante las pruebas,')
  console.log('esos registros NO se borran aquí; revísalos manualmente si quieres limpiarlos.')

  await sequelize.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  if (err.errors) err.errors.forEach(e => console.error('  -', e.path, ':', e.message))
  process.exit(1)
})
