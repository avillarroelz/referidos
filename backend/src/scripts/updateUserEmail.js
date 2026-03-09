// backend/src/scripts/updateUserEmail.js
const { sequelize } = require('../db/connection')
const { loadModels } = require('../db/loadModels')
const associate = require('../db/associate')

async function updateUserEmail() {
  try {
    await sequelize.authenticate()
    console.log('✅ Conexión a base de datos establecida')

    const models = loadModels(sequelize)
    associate(models)

    const Usuario = models.usuario

    const usuario = await Usuario.findOne({
      where: { username: 'avillarroel' }
    })

    if (!usuario) {
      console.log('❌ Usuario avillarroel no encontrado')
      process.exit(1)
    }

    console.log('\n📋 Usuario actual:')
    console.log('  ID:', usuario.id)
    console.log('  Username:', usuario.username)
    console.log('  Correo actual:', usuario.correo || 'Sin correo')

    // Actualizar correo
    await usuario.update({ correo: 'avillarroel@ecora.cl' })

    console.log('\n✅ Correo actualizado exitosamente a: avillarroel@ecora.cl')

    // Verificar actualización
    await usuario.reload()
    console.log('\n✔️  Verificación:')
    console.log('  Username:', usuario.username)
    console.log('  Correo:', usuario.correo)

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

updateUserEmail()
