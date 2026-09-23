// backend/src/controllers/feedback.controller.js
// Reportes de la pantalla principal (bug / corrección / recomendación) enviados por
// usuarios internos. Las imágenes adjuntas se suben a S3 (carpeta feedback/) con
// fallback local; su metadata queda en el campo JSONB `imagenes` del feedback.
const fs = require('fs')
const path = require('path')
const { body, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const s3Service = require('../services/s3Service')
const { logger } = require('../utils/logger')

const Feedback = () => getModel('Feedback')
const Usuario = () => getModel('Usuario')

const useS3 = s3Service.isConfigured()

const TIPOS = ['BUG', 'CORRECCION', 'RECOMENDACION']
const ESTADOS = ['PENDIENTE', 'EN_REVISION', 'RESUELTO', 'DESCARTADO']

// ──────────────────────────────────────────────────────────────
// Validadores

const crearValidators = [
  body('tipo').optional({ values: 'falsy' }).isIn(TIPOS).withMessage('Tipo inválido'),
  body('titulo').optional({ values: 'falsy' }).isString().trim().isLength({ max: 150 }).escape(),
  body('mensaje').isString().trim().notEmpty().withMessage('El mensaje es obligatorio').isLength({ max: 4000 }).escape(),
  body('url').optional({ values: 'falsy' }).isString().trim().isLength({ max: 255 }),
]

const estadoValidators = [
  body('estado').isIn(ESTADOS).withMessage('Estado inválido'),
  body('notaResolucion').optional({ values: 'falsy' }).isString().trim().isLength({ max: 2000 }).escape(),
]

// ──────────────────────────────────────────────────────────────
// Crear feedback (usuarios internos autenticados). Imágenes opcionales.

async function crear(req, res) {
  const imgFiles = req.files || []

  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: errors.array() })
  }

  // Solo se aceptan imágenes
  const noImagen = imgFiles.find(f => !f.mimetype.startsWith('image/'))
  if (noImagen) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'Solo se permiten imágenes (JPG/PNG)', param: 'imagenes' }] })
  }

  const t = await sequelize.transaction()
  try {
    const fb = await Feedback().create({
      tipo: req.body.tipo || 'BUG',
      titulo: req.body.titulo ? String(req.body.titulo).trim() : null,
      mensaje: String(req.body.mensaje).trim(),
      url: req.body.url ? String(req.body.url).trim() : null,
      estado: 'PENDIENTE',
      autorUserId: req.auth?.id || null,
      imagenes: [],
    }, { transaction: t })

    // Subir cada imagen y acumular su metadata
    const imagenes = []
    for (const file of imgFiles) {
      imagenes.push(await guardarImagen(file, fb.id))
    }
    if (imagenes.length > 0) {
      fb.imagenes = imagenes
      await fb.save({ transaction: t })
    }

    await t.commit()

    return res.status(201).json({
      ok: true,
      message: '¡Gracias! Tu reporte fue enviado.',
      id: fb.id,
    })
  } catch (err) {
    await t.rollback()
    cleanupTempFiles(req)
    console.error('[feedback] crear FAIL', err)
    return res.status(500).json({ error: 'No se pudo enviar el reporte' })
  }
}

// ──────────────────────────────────────────────────────────────
// Listar feedbacks (solo ADMIN). Filtro opcional por estado.

async function listar(req, res) {
  const page = Math.max(Number(req.query.page) || 1, 1)
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200)
  const offset = (page - 1) * limit

  const where = {}
  if (req.query.estado && ESTADOS.includes(req.query.estado)) {
    where.estado = req.query.estado
  }

  try {
    const { rows, count } = await Feedback().findAndCountAll({
      where,
      include: [{ model: Usuario(), as: 'autor', attributes: ['id', 'username', 'correo'] }],
      order: [['id', 'DESC']],
      limit,
      offset,
    })

    return res.json({ data: rows, total: count, page, limit })
  } catch (err) {
    console.error('[feedback] listar FAIL', err)
    return res.status(500).json({ error: 'No se pudieron obtener los reportes' })
  }
}

// ──────────────────────────────────────────────────────────────
// Conteo de feedbacks pendientes (badge para ADMIN)

async function contarPendientes(_req, res) {
  try {
    const count = await Feedback().count({ where: { estado: 'PENDIENTE' } })
    return res.json({ count })
  } catch (err) {
    console.error('[feedback] contarPendientes FAIL', err)
    return res.status(500).json({ error: 'Error al contar reportes' })
  }
}

// ──────────────────────────────────────────────────────────────
// Cambiar estado / agregar nota de resolución (solo ADMIN)

async function cambiarEstado(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  try {
    const fb = await Feedback().findByPk(Number(req.params.id))
    if (!fb) return res.status(404).json({ error: 'Reporte no encontrado' })

    fb.estado = req.body.estado
    if (req.body.notaResolucion !== undefined) {
      fb.notaResolucion = req.body.notaResolucion ? String(req.body.notaResolucion).trim() : null
    }
    await fb.save()

    return res.json({ ok: true })
  } catch (err) {
    console.error('[feedback] cambiarEstado FAIL', err)
    return res.status(500).json({ error: 'No se pudo actualizar el reporte' })
  }
}

// ──────────────────────────────────────────────────────────────
// Obtener una imagen del feedback (URL firmada S3 o archivo local). Solo ADMIN.

async function obtenerImagen(req, res) {
  try {
    const fb = await Feedback().findByPk(Number(req.params.id))
    if (!fb) return res.status(404).json({ error: 'Reporte no encontrado' })

    const idx = Number(req.params.idx)
    const imagenes = Array.isArray(fb.imagenes) ? fb.imagenes : []
    const img = imagenes[idx]
    if (!img) return res.status(404).json({ error: 'Imagen no encontrada' })

    // S3: redirigir a URL firmada temporal
    if (img.s3Key && useS3) {
      const url = await s3Service.getSignedDownloadUrl(img.s3Key, 3600)
      return res.redirect(url)
    }

    // Fallback local
    const abs = path.resolve(process.cwd(), img.ruta)
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'Archivo no disponible' })
    return res.sendFile(abs)
  } catch (err) {
    console.error('[feedback] obtenerImagen FAIL', err)
    return res.status(500).json({ error: 'No se pudo obtener la imagen' })
  }
}

// ──────────────────────────────────────────────────────────────
// Helpers

// Sube una imagen a S3 (con fallback local) y devuelve su metadata.
async function guardarImagen(file, feedbackId) {
  let rutaFinal = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
  let s3Key = null
  if (useS3) {
    try {
      const fileContent = fs.readFileSync(file.path)
      s3Key = s3Service.generateFeedbackFileKey(feedbackId, file.originalname)
      await s3Service.uploadFile(fileContent, s3Key, file.mimetype, {
        feedbackId: String(feedbackId),
        originalName: file.originalname,
      })
      rutaFinal = s3Key
      try { fs.unlinkSync(file.path) } catch {}
      console.log(`✅ imagen feedback subida a S3: ${s3Key}`)
    } catch (e) {
      // La key ya estaba asignada: sin esto la metadata afirma estar en S3 y no lo está.
      s3Key = null
      logger.error('[feedback] Falló la subida a S3, queda solo copia local', {
        feedbackId, archivo: file.originalname, error: e.message,
      })
    }
  }

  return {
    nombre: file.originalname,
    ruta: rutaFinal,
    s3Key,
    mimetype: file.mimetype,
    size: file.size,
  }
}

function cleanupTempFiles(req) {
  const files = req.files || []
  for (const file of files) {
    if (file?.path) {
      try { fs.unlinkSync(file.path) } catch {}
    }
  }
}

module.exports = {
  crear,
  crearValidators,
  listar,
  contarPendientes,
  cambiarEstado,
  estadoValidators,
  obtenerImagen,
}
