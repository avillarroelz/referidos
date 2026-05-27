// backend/src/controllers/postulaciones.controller.js
// Postulaciones de usuarios externos autenticados: se ligan a su cuenta
// (postulanteUserId) para que puedan ver "Mis postulaciones".
const { body, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS } = require('../lib/estados')
const { notificarNuevoReferidoPublico } = require('../services/notificationService')

const Referido = () => getModel('Referido')
const EstadoHistorial = () => getModel('EstadoHistorial')

// ──────────────────────────────────────────────────────────────
// Validadores (mismos campos que el formulario público de postulación)

const crearValidators = [
  body('nombre').isString().notEmpty().trim().escape().isLength({ max: 100 }).withMessage('nombre es obligatorio (máx 100 caracteres)'),
  body('segundoNombre').optional().isString().trim().escape().isLength({ max: 100 }),
  body('apellidoPaterno').optional().isString().trim().escape().isLength({ max: 100 }),
  body('apellidoMaterno').optional().isString().trim().escape().isLength({ max: 100 }),
  body('fechaNacimiento').optional({ values: 'falsy' }).isISO8601().withMessage('fecha de nacimiento inválida'),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail().withMessage('email inválido'),
  body('telefono').optional().isString().trim().isLength({ max: 30 }),
  body('rut').optional().isString().trim().isLength({ max: 20 }),
  body('cargoPostulado').optional().isString().trim().escape().isLength({ max: 200 }),
  body('observaciones').optional().isString().trim().escape().isLength({ max: 1000 }),
]

// ──────────────────────────────────────────────────────────────
// Crear postulación ligada al usuario autenticado

async function crear(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const t = await sequelize.transaction()
  try {
    // Nombre completo a partir de los campos individuales
    const partes = [
      req.body.nombre,
      req.body.segundoNombre,
      req.body.apellidoPaterno,
      req.body.apellidoMaterno,
    ].filter(Boolean).map(s => String(s).trim().toUpperCase())
    const nombreCompleto = partes.join(' ')

    // Datos extra en observaciones
    const obs = []
    if (req.body.fechaNacimiento) obs.push(`FECHA NAC: ${req.body.fechaNacimiento}`)
    if (req.body.observaciones) obs.push(String(req.body.observaciones).trim().toUpperCase())
    const observacionesFinal = obs.length > 0 ? obs.join(' | ') : null

    const ref = await Referido().create({
      nombre: nombreCompleto,
      email: req.body.email || null,
      telefono: req.body.telefono || null,
      rut: req.body.rut || null,
      cargoPostulado: req.body.cargoPostulado ? String(req.body.cargoPostulado).trim().toUpperCase() : null,
      observaciones: observacionesFinal,
      estado: ESTADOS.PENDIENTE,
      creadoPorUserId: req.auth.id,
      postulanteUserId: req.auth.id,
      origenPublico: false,
    }, { transaction: t })

    await EstadoHistorial().create({
      referidoId: ref.id,
      actorUserId: req.auth.id,
      desde: ESTADOS.PENDIENTE,
      hacia: ESTADOS.PENDIENTE,
      comentario: 'Postulación creada por el postulante',
    }, { transaction: t })

    await t.commit()

    notificarNuevoReferidoPublico(ref).catch(err =>
      console.error('[postulaciones] notificación FAIL:', err.message)
    )

    return res.status(201).json({
      ok: true,
      message: 'Postulación registrada exitosamente.',
      id: ref.id,
    })
  } catch (err) {
    await t.rollback()
    console.error('[postulaciones] crear FAIL', err)

    if (err.name === 'SequelizeUniqueConstraintError') {
      const field = err.errors[0]?.path || 'campo'
      return res.status(409).json({ error: `El ${field} ya existe en el sistema` })
    }

    return res.status(500).json({ error: 'No se pudo registrar la postulación' })
  }
}

// ──────────────────────────────────────────────────────────────
// Listar las postulaciones del usuario autenticado

async function listarMias(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const page = Number(req.query.page) || 1
  const limit = Number(req.query.limit) || 25
  const offset = (page - 1) * limit

  try {
    const { rows, count } = await Referido().findAndCountAll({
      where: { postulanteUserId: req.auth.id },
      attributes: ['id', 'nombre', 'cargoPostulado', 'estado', 'email', 'telefono', 'rut', 'observaciones', 'created_at', 'updated_at'],
      order: [['id', 'DESC']],
      limit,
      offset,
    })

    return res.json({ data: rows, page, limit, total: count })
  } catch (err) {
    console.error('[postulaciones] listarMias FAIL', err)
    return res.status(500).json({ error: 'No se pudieron obtener tus postulaciones' })
  }
}

module.exports = { crear, crearValidators, listarMias }
