// src/server.js
require('dotenv').config()
const { app } = require('./app')
const { config } = require('./config')
const { sequelize, getModel } = require('./db')
const { hash } = require('./utils/hash')
const { transporter } = require('./utils/mailer')

async function seedRolesAndAdmin() {
  if (process.env.SEED_ROLES !== 'true') return

  const Usuario = getModel('Usuario')
  const Rol = getModel('Rol')

  // 1) Crear roles base
  const defaults = (process.env.ROLES_DEFAULT || 'TRABAJADOR,RRHH,ADMIN,ADC,JefeRRHH,EXTERNO')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  for (const nombre of defaults) {
    await Rol.findOrCreate({
      where: { nombre },
      defaults: { nombre, descripcion: nombre }
    })
  }

  // 2) Asegurar que el admin tenga rol ADMIN (o el que definas en .env)
  const adminEmail = config.adminEmail
  const adminRoleName = process.env.ADMIN_ROLE || 'ADMIN'
  const admin = await Usuario.findOne({ where: { correo: adminEmail } })
  const adminRole = await Rol.findOne({ where: { nombre: adminRoleName } })

  if (admin && adminRole) {
    // addRole proviene de belongsToMany(as:'roles')
    const rolesAdmin = await admin.getRoles()
    const hasAdmin = rolesAdmin.some(r => r.nombre === adminRoleName)
    if (!hasAdmin) {
      await admin.addRole(adminRole)
      console.log(`🔐 Rol ${adminRoleName} asignado a ${adminEmail}`)
    }
  }
}

async function bootstrap(){
  try{
    // Validaciones de seguridad al iniciar
    if (config.jwt.secret === config.jwt.refreshSecret) {
      console.warn('⚠️  SEGURIDAD: JWT_SECRET y JWT_REFRESH_SECRET son idénticos. Usa valores diferentes.')
    }
    if (config.jwt.secret.length < 16) {
      console.warn('⚠️  SEGURIDAD: JWT_SECRET es muy corto (mínimo 16 caracteres recomendado)')
    }
    if (!process.env.INTEGRACION_API_KEY) {
      console.warn('⚠️  SEGURIDAD: INTEGRACION_API_KEY no configurada — endpoint de integración deshabilitado')
    }

    await sequelize.authenticate()
    console.log('✅ DB conectada')

    try {
      await Promise.race([
        transporter.verify().then(() => console.log('📧 SMTP verificado y listo')),
        new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP verify timeout (3s)')), 3000))
      ])
    } catch(e){ console.warn('⚠️ SMTP no verificó:', e.message) }

    if (config.syncDb) {
      await sequelize.sync({ alter: true })
      console.log('🛠️ Tablas sincronizadas')
    }

    // Seed admin user (si no existe)
    if (config.seedAdmin) {
      const Usuario = getModel('Usuario')
      const exists = await Usuario.findOne({ where:{ correo: config.adminEmail } })
      if (!exists) {
        await Usuario.create({
          username:'admin',
          correo: config.adminEmail,
          password: await hash(config.adminPass),
          estado:true
        })
        console.log(`👑 Admin creado: ${config.adminEmail} (contraseña configurada en .env)`)
      }
    }

    // Seed roles y asignación al admin
    await seedRolesAndAdmin()

    app.listen(config.port, () => {
      console.log(`🚀 API en http://localhost:${config.port}`)

      // SLA cron: verificar cada hora
      const { verificarSLAsVencidos } = require('./services/slaService')
      setInterval(verificarSLAsVencidos, 60 * 60 * 1000)
      console.log('⏰ SLA cron job iniciado (cada 1h)')

      // Respaldo local de la lista de no recontratación: al arrancar y cada hora.
      // No se espera ni puede lanzar: sin black el arranque sigue igual.
      const { actualizarHuellas } = require('./services/listaBloqueo')
      actualizarHuellas()
      setInterval(actualizarHuellas, 60 * 60 * 1000)
    })
  }catch(err){
    console.error('❌ Error al iniciar:', err)
    process.exit(1)
  }
}
bootstrap()
