// Script para asignar rol ADMIN al usuario avillarroel
const { sequelize } = require('../db/connection')
const { DataTypes } = require('sequelize')
const { loadModels } = require('../db/loadModels')
const associate = require('../db/associate')

async function assignAdminRole() {
  try {
    await sequelize.authenticate()
    console.log('✅ Conexión a base de datos establecida')

    // Cargar modelos
    const models = loadModels(sequelize)
    associate(models)

    const Usuario = models.usuario
    const Rol = models.roles

    if (!Usuario || !Rol) {
      console.log('❌ No se pudieron cargar los modelos')
      console.log('Modelos disponibles:', Object.keys(models))
      process.exit(1)
    }

    // Buscar usuario avillarroel
    const usuario = await Usuario.findOne({
      where: { username: 'avillarroel' },
      include: [{ association: 'roles' }]
    })

    if (!usuario) {
      console.log('❌ Usuario "avillarroel" no encontrado')
      console.log('\nUsuarios disponibles:')
      const usuarios = await Usuario.findAll({ attributes: ['id', 'username', 'correo'] })
      if (usuarios.length === 0) {
        console.log('  No hay usuarios en la base de datos')
      } else {
        usuarios.forEach(u => console.log(`  - ID: ${u.id}, Username: ${u.username}, Email: ${u.correo}`))
      }
      process.exit(1)
    }

    console.log(`\n✅ Usuario encontrado:`)
    console.log(`   ID: ${usuario.id}`)
    console.log(`   Username: ${usuario.username}`)
    console.log(`   Email: ${usuario.correo}`)
    console.log(`   Roles actuales: ${usuario.roles.map(r => r.nombre).join(', ') || 'ninguno'}`)

    // Buscar rol ADMIN
    const rolAdmin = await Rol.findOne({ where: { nombre: 'ADMIN' } })

    if (!rolAdmin) {
      console.log('\n❌ Rol ADMIN no encontrado')
      const rolesDisponibles = await Rol.findAll({ attributes: ['id', 'nombre'] })
      console.log('Roles disponibles:')
      rolesDisponibles.forEach(r => console.log(`  - ${r.nombre}`))
      process.exit(1)
    }

    // Verificar si ya tiene el rol
    const tieneRolAdmin = usuario.roles.some(r => r.nombre === 'ADMIN')

    if (tieneRolAdmin) {
      console.log('\nℹ️  El usuario ya tiene el rol ADMIN')
    } else {
      // Asignar rol ADMIN
      await usuario.addRole(rolAdmin)
      console.log('\n✅ Rol ADMIN asignado exitosamente')
    }

    // Verificar asignación
    const usuarioActualizado = await Usuario.findByPk(usuario.id, {
      include: [{ association: 'roles' }]
    })

    console.log(`\n📋 Roles finales del usuario ${usuario.username}:`)
    usuarioActualizado.roles.forEach(r => {
      console.log(`   ✓ ${r.nombre}`)
    })

    console.log('\n✅ Proceso completado exitosamente')
    process.exit(0)
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

assignAdminRole()
