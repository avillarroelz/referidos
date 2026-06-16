// Script para crear usuarios de prueba con cada rol
const { sequelize } = require('../db/connection')
const { loadModels } = require('../db/loadModels')
const associate = require('../db/associate')
const bcrypt = require('bcryptjs')

const ROLES = ['ADMIN', 'RRHH', 'JefeRRHH', 'TRABAJADOR', 'ADC', 'EXTERNO']
const PASSWORD = 'TestPassword123!'

async function main() {
  await sequelize.authenticate()
  const models = loadModels(sequelize)
  associate(models)
  const Usuario = models.usuario
  const Rol = models.roles

  // Resincronizar secuencia de PK (seedAdmin insertó con ID forzado)
  await sequelize.query(`SELECT setval('usuarios_id_seq', COALESCE((SELECT MAX(id)+1 FROM usuarios), 1), false)`)
  await sequelize.query(`SELECT setval('roles_id_seq', COALESCE((SELECT MAX(id)+1 FROM roles), 1), false)`)

  const hashed = await bcrypt.hash(PASSWORD, 10)

  for (const roleName of ROLES) {
    let rol = await Rol.findOne({ where: { nombre: roleName } })
    if (!rol) {
      rol = await Rol.create({ nombre: roleName, descripcion: `Rol ${roleName}` })
      console.log(`  Rol ${roleName} creado`)
    }

    const email = `test_${roleName.toLowerCase()}@ecora.cl`
    let usuario = await Usuario.findOne({
      where: { correo: email },
      include: [{ association: 'roles' }],
    })

    if (!usuario) {
      usuario = await Usuario.create({
        username: `test_${roleName.toLowerCase()}`,
        correo: email,
        password: hashed,
        estado: true,
      })
      console.log(`  Usuario creado: ${email}`)
    } else {
      await usuario.update({ password: hashed, estado: true })
    }

    await usuario.setRoles([rol])
    console.log(`  ${email} -> [${roleName}]`)
  }

  console.log('\nListo. Usuarios de prueba:')
  ROLES.forEach(r => console.log(`  test_${r.toLowerCase()}@ecora.cl / ${PASSWORD} -> ${r}`))

  await sequelize.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('Error:', err.message)
  if (err.errors) err.errors.forEach(e => console.error('  -', e.path, ':', e.message))
  process.exit(1)
})
