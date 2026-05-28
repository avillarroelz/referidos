// backend/src/controllers/postulaciones.controller.js
// Postulaciones: con sesión quedan ligadas a la cuenta (postulanteUserId);
// sin sesión, se crean como pública (creadoPor = admin) — mismo flujo, autenticación opcional.
const fs = require('fs')
const path = require('path')
const { body, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS } = require('../lib/estados')
const { notificarNuevoReferidoPublico } = require('../services/notificationService')
const s3Service = require('../services/s3Service')

const Referido = () => getModel('Referido')
const EstadoHistorial = () => getModel('EstadoHistorial')
const Documento = () => getModel('Documento')

const useS3 = s3Service.isConfigured()

// ──────────────────────────────────────────────────────────────
// Validadores (campos obligatorios para postulaciones)

const crearValidators = [
  body('nombre').isString().trim().notEmpty().withMessage('Nombre obligatorio').isLength({ max: 100 }).escape(),
  body('segundoNombre').optional({ values: 'falsy' }).isString().trim().escape().isLength({ max: 100 }),
  body('apellidoPaterno').isString().trim().notEmpty().withMessage('Apellido paterno obligatorio').isLength({ max: 100 }).escape(),
  body('apellidoMaterno').optional({ values: 'falsy' }).isString().trim().escape().isLength({ max: 100 }),
  body('fechaNacimiento').isISO8601().withMessage('Fecha de nacimiento obligatoria'),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail().withMessage('Email inválido'),
  body('telefono').isString().trim().notEmpty().withMessage('Teléfono obligatorio').isLength({ max: 30 }),
  body('rut').isString().trim().notEmpty().withMessage('RUT obligatorio').isLength({ max: 20 }),
  body('cargoPostulado').isString().trim().notEmpty().withMessage('Cargo obligatorio').isLength({ max: 200 }).escape(),
  body('observaciones').optional({ values: 'falsy' }).isString().trim().escape().isLength({ max: 1000 }),
]

// ──────────────────────────────────────────────────────────────
// Crear postulación (con o sin sesión; el archivo PDF de CV es OBLIGATORIO)

async function crear(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    cleanupTempFile(req.file)
    return res.status(400).json({ errors: errors.array() })
  }

  // Archivo CV obligatorio (PDF)
  if (!req.file) {
    return res.status(400).json({ errors: [{ msg: 'Debes adjuntar tu CV en PDF', param: 'cv' }] })
  }
  if (req.file.mimetype !== 'application/pdf') {
    cleanupTempFile(req.file)
    return res.status(400).json({ errors: [{ msg: 'El CV debe ser un archivo PDF', param: 'cv' }] })
  }

  const t = await sequelize.transaction()
  try {
    // Determinar creador / postulante (auth opcional)
    let creadorId
    let postulanteId = null
    if (req.auth?.id) {
      creadorId = req.auth.id
      postulanteId = req.auth.id
    } else {
      // Sin sesión: el creador formal es un admin (mismo patrón que /public/referidos)
      const Usuario = getModel('Usuario')
      const Rol = getModel('Rol')
      const rolAdmin = await Rol.findOne({ where: { nombre: 'ADMIN' } })
      if (rolAdmin) {
        const admins = await rolAdmin.getUsuarios()
        if (admins.length > 0) creadorId = admins[0].id
      }
      if (!creadorId) {
        const rolRRHH = await Rol.findOne({ where: { nombre: 'RRHH' } })
        if (rolRRHH) {
          const rrhh = await rolRRHH.getUsuarios()
          if (rrhh.length > 0) creadorId = rrhh[0].id
        }
      }
      if (!creadorId) {
        await t.rollback()
        cleanupTempFile(req.file)
        return res.status(500).json({ error: 'No hay usuarios administrativos configurados' })
      }
    }

    // Nombre completo
    const partes = [
      req.body.nombre,
      req.body.segundoNombre,
      req.body.apellidoPaterno,
      req.body.apellidoMaterno,
    ].filter(Boolean).map(s => String(s).trim().toUpperCase())
    const nombreCompleto = partes.join(' ')

    // Observaciones + fecha de nacimiento
    const obs = []
    if (req.body.fechaNacimiento) obs.push(`FECHA NAC: ${req.body.fechaNacimiento}`)
    if (req.body.observaciones) obs.push(String(req.body.observaciones).trim().toUpperCase())
    const observacionesFinal = obs.length > 0 ? obs.join(' | ') : null

    // Si hay sesión, el correo SIEMPRE es el de la cuenta (ignorar lo enviado por el form)
    let emailFinal = null
    if (req.auth?.id) {
      const Usuario = getModel('Usuario')
      const userDb = await Usuario.findByPk(req.auth.id, { attributes: ['correo'] })
      emailFinal = userDb?.correo || req.body.email || null
    } else {
      emailFinal = req.body.email || null
    }

    const ref = await Referido().create({
      nombre: nombreCompleto,
      email: emailFinal,
      telefono: req.body.telefono || null,
      rut: req.body.rut || null,
      cargoPostulado: req.body.cargoPostulado ? String(req.body.cargoPostulado).trim().toUpperCase() : null,
      observaciones: observacionesFinal,
      estado: ESTADOS.PENDIENTE,
      creadoPorUserId: creadorId,
      postulanteUserId: postulanteId,
      origenPublico: !req.auth?.id,
    }, { transaction: t })

    await EstadoHistorial().create({
      referidoId: ref.id,
      actorUserId: creadorId,
      desde: ESTADOS.PENDIENTE,
      hacia: ESTADOS.PENDIENTE,
      comentario: req.auth?.id ? 'Postulación creada por el postulante' : 'Postulación desde formulario público',
    }, { transaction: t })

    // Subir CV como adjunto (S3 si está configurado; si falla, fallback local)
    let rutaFinal = path.relative(process.cwd(), req.file.path).replace(/\\/g, '/')
    let s3Key = null
    if (useS3) {
      try {
        const fileContent = fs.readFileSync(req.file.path)
        s3Key = s3Service.generateReferidoFileKey(req.body.rut || 'sin-rut', ref.id, req.file.originalname, 'cv')
        await s3Service.uploadFile(fileContent, s3Key, req.file.mimetype, {
          referidoId: String(ref.id),
          originalName: req.file.originalname,
          tipo: 'cv',
        })
        rutaFinal = s3Key
        try { fs.unlinkSync(req.file.path) } catch {}
        console.log(`✅ CV subido a S3: ${s3Key}`)
      } catch (e) {
        console.warn('⚠️ Falló S3, guardando localmente:', e.message)
      }
    }

    await Documento().create({
      nombre: req.file.originalname,
      ruta: rutaFinal,
      s3Key,
      mimetype: req.file.mimetype,
      size: req.file.size,
      referidoId: ref.id,
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
    cleanupTempFile(req.file)
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

// Limpia el archivo temporal subido si el flujo falla antes de procesarlo
function cleanupTempFile(file) {
  if (!file?.path) return
  try { fs.unlinkSync(file.path) } catch {}
}

module.exports = { crear, crearValidators, listarMias }
