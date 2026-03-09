// backend/src/controllers/publicReferidos.controller.js
const { body, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS } = require('../lib/estados')
const { notificarNuevoReferidoPublico } = require('../services/notificationService')

const Referido = () => getModel('Referido')
const EstadoHistorial = () => getModel('EstadoHistorial')

// ──────────────────────────────────────────────────────────────
// Validadores

const crearPublicoValidators = [
  body('nombre').isString().notEmpty().withMessage('nombre es obligatorio'),
  body('email').optional().isEmail().withMessage('email inválido'),
  body('telefono').optional().isString(),
  body('rut').optional().isString(),
  body('cargoPostulado').optional().isString(),
  body('observaciones').optional().isString(),
  body('nombreReferidor').optional().isString(),
]

// ──────────────────────────────────────────────────────────────
// Crear referido desde formulario público (sin auth)

async function crearPublico(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const t = await sequelize.transaction()
  try {
    // Buscar un usuario ADMIN para asignar como "creador" del referido público
    const Usuario = getModel('Usuario')
    const Rol = getModel('Rol')
    const rolAdmin = await Rol.findOne({ where: { nombre: 'ADMIN' } })

    let creadorId = null
    if (rolAdmin) {
      const admins = await rolAdmin.getUsuarios()
      if (admins.length > 0) creadorId = admins[0].id
    }

    // Si no hay admin, buscar RRHH
    if (!creadorId) {
      const rolRRHH = await Rol.findOne({ where: { nombre: 'RRHH' } })
      if (rolRRHH) {
        const rrhh = await rolRRHH.getUsuarios()
        if (rrhh.length > 0) creadorId = rrhh[0].id
      }
    }

    if (!creadorId) {
      await t.rollback()
      return res.status(500).json({ error: 'No hay usuarios administrativos configurados' })
    }

    const ref = await Referido().create({
      nombre: String(req.body.nombre || '').trim(),
      email: req.body.email || null,
      telefono: req.body.telefono || null,
      rut: req.body.rut || null,
      cargoPostulado: req.body.cargoPostulado || null,
      observaciones: req.body.observaciones || null,
      nombreReferidor: req.body.nombreReferidor || null,
      estado: ESTADOS.PENDIENTE,
      creadoPorUserId: creadorId,
      origenPublico: true,
    }, { transaction: t })

    await EstadoHistorial().create({
      referidoId: ref.id,
      actorUserId: creadorId,
      desde: ESTADOS.PENDIENTE,
      hacia: ESTADOS.PENDIENTE,
      comentario: 'Creación desde formulario público',
    }, { transaction: t })

    await t.commit()

    // Notificar a RRHH (no bloqueante)
    notificarNuevoReferidoPublico(ref).catch(err =>
      console.error('[publicReferidos] notificación FAIL:', err.message)
    )

    console.log(`[publicReferidos] Referido público creado: id=${ref.id}`)
    return res.status(201).json({
      ok: true,
      message: 'Referido registrado exitosamente. El equipo de RRHH lo revisará pronto.',
      id: ref.id,
    })
  } catch (err) {
    await t.rollback()
    console.error('[publicReferidos] crearPublico FAIL', err)

    if (err.name === 'SequelizeUniqueConstraintError') {
      const field = err.errors[0]?.path || 'campo'
      return res.status(409).json({ error: `El ${field} ya existe en el sistema` })
    }

    return res.status(500).json({ error: 'No se pudo registrar el referido' })
  }
}

module.exports = { crearPublico, crearPublicoValidators }
