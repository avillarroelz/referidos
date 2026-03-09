// backend/src/scripts/createAdminUser.js
const { sequelize } = require('../db/connection')
const { loadModels } = require('../db/loadModels')
const associate = require('../db/associate')
const bcrypt = require('bcryptjs')

async function createAdminUser() {
  try {
    await sequelize.authenticate()
    console.log('✅ Conexión a base de datos establecida')

    const models = loadModels(sequelize)
    associate(models)

    const Usuario = models.usuario
    const Rol = models.roles

    // Verificar si el usuario ya existe
    let usuario = await Usuario.findOne({
      where: { correo: 'avillarroel@ecora.cl' },
      include: [{ association: 'roles' }]
    })

    if (usuario) {
      console.log('\n📋 Usuario ya existe:')
      console.log('  ID:', usuario.id)
      console.log('  Username:', usuario.username)
      console.log('  Correo:', usuario.correo)
      console.log('  Roles:', usuario.roles?.map(r => r.nombre).join(', ') || 'Sin roles')
    } else {
      // Crear nuevo usuario
      const hashedPassword = await bcrypt.hash('admin123', 10)

      usuario = await Usuario.create({
        username: 'avillarroel',
        correo: 'avillarroel@ecora.cl',
        password: hashedPassword,
        estado: true
      })

      console.log('\n✅ Usuario creado exitosamente:')
      console.log('  ID:', usuario.id)
      console.log('  Username:', usuario.username)
      console.log('  Correo:', usuario.correo)
      console.log('  Password temporal: admin123')
    }

    // Verificar/crear rol ADMIN
    let rolAdmin = await Rol.findOne({ where: { nombre: 'ADMIN' } })

    if (!rolAdmin) {
      rolAdmin = await Rol.create({
        nombre: 'ADMIN',
        descripcion: 'Administrador del sistema con acceso completo'
      })
      console.log('\n✅ Rol ADMIN creado')
    }

    // Recargar usuario con roles
    await usuario.reload({ include: [{ association: 'roles' }] })

    // Verificar si ya tiene el rol ADMIN
    const tieneRolAdmin = usuario.roles?.some(r => r.nombre === 'ADMIN')

    if (!tieneRolAdmin) {
      await usuario.addRole(rolAdmin)
      console.log('\n✅ Rol ADMIN asignado al usuario')
    } else {
      console.log('\n✔️  El usuario ya tiene el rol ADMIN')
    }

    // Mostrar resultado final
    await usuario.reload({ include: [{ association: 'roles' }] })
    console.log('\n📊 RESULTADO FINAL:')
    console.log('  Username:', usuario.username)
    console.log('  Correo:', usuario.correo)
    console.log('  Roles:', usuario.roles?.map(r => r.nombre).join(', '))

    await sequelize.close()
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    if (error.errors) {
      error.errors.forEach(err => console.error('  -', err.message))
    }
    process.exit(1)
  }
}

createAdminUser()
