// backend/src/controllers/postulaciones.controller.js
// Postulaciones: con sesión quedan ligadas a la cuenta (postulanteUserId);
// sin sesión, se crean como pública (creadoPor = admin) — mismo flujo, autenticación opcional.
const fs = require('fs')
const path = require('path')
const { body, validationResult } = require('express-validator')
const { Op } = require('sequelize')
const { sequelize, getModel } = require('../db')
const { ESTADOS } = require('../lib/estados')
const { notificarNuevoReferidoPublico } = require('../services/notificationService')
const { verificarRut } = require('../services/listaBloqueo')
const s3Service = require('../services/s3Service')
const { logger } = require('../utils/logger')

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
  // Con uploader.fields(), multer entrega los archivos en req.files (objeto por campo)
  const cvFile = req.files?.cv?.[0] || null
  const certFiles = req.files?.certificados || []
  const docFiles = req.files?.documentos || []

  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: errors.array() })
  }

  // Archivo CV obligatorio (PDF)
  if (!cvFile) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'Debes adjuntar tu CV en PDF', param: 'cv' }] })
  }
  if (cvFile.mimetype !== 'application/pdf') {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'El CV debe ser un archivo PDF', param: 'cv' }] })
  }

  // Certificados de estudio: al menos uno (4° medio), hasta 3 (lo acota multer), solo PDF
  if (certFiles.length === 0) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'Debes adjuntar al menos un certificado de estudio en PDF', param: 'certificados' }] })
  }
  if (certFiles.some(f => f.mimetype !== 'application/pdf')) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'Los certificados de estudio deben ser archivos PDF', param: 'certificados' }] })
  }

  // Documentos adicionales: opcionales, pero solo se aceptan PDF
  const docNoPdf = docFiles.find(f => f.mimetype !== 'application/pdf')
  if (docNoPdf) {
    cleanupTempFiles(req)
    return res.status(400).json({ errors: [{ msg: 'Los documentos adicionales deben ser archivos PDF', param: 'documentos' }] })
  }

  // Bloquear doble postulación al MISMO cargo con el MISMO RUT (comparando el RUT
  // sin puntos ni guión para tolerar distintos formatos de ingreso).
  const rutNorm = String(req.body.rut || '').replace(/[.-]/g, '').trim()
  const cargoNorm = req.body.cargoPostulado ? String(req.body.cargoPostulado).trim().toUpperCase() : null
  if (rutNorm && cargoNorm) {
    const yaExiste = await Referido().findOne({
      where: {
        cargoPostulado: cargoNorm,
        [Op.and]: sequelize.where(
          sequelize.fn('REPLACE', sequelize.fn('REPLACE', sequelize.col('rut'), '.', ''), '-', ''),
          rutNorm
        ),
      },
    })
    if (yaExiste) {
      cleanupTempFiles(req)
      return res.status(409).json({
        code: 'DUPLICATE_POSTULACION',
        error: 'Ya tienes una postulación para este cargo. No puedes postular dos veces al mismo cargo, '
          + 'pero sí puedes agregar más documentos o editarla desde "Mis Postulaciones".',
      })
    }
  }

  // Lista de no recontratación: se acepta igual (sin avisar al postulante) y
  // RRHH ve la marca. Se consulta antes de abrir la transacción.
  const { bloqueado } = await verificarRut(req.body.rut)

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
        cleanupTempFiles(req)
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
      enListaBloqueo: bloqueado,
    }, { transaction: t })

    await EstadoHistorial().create({
      referidoId: ref.id,
      actorUserId: creadorId,
      desde: ESTADOS.PENDIENTE,
      hacia: ESTADOS.PENDIENTE,
      comentario: req.auth?.id ? 'Postulación creada por el postulante' : 'Postulación desde formulario público',
    }, { transaction: t })

    // Subir CV (obligatorio) + documentos adicionales (opcionales) como adjuntos.
    // S3 si está configurado; si falla, fallback local. Cada archivo => un Documento.
    await guardarDocumento(cvFile, ref, req.body.rut, 'cv', t)
    for (const cert of certFiles) {
      await guardarDocumento(cert, ref, req.body.rut, 'certificado', t, PREFIJO_CERTIFICADO)
    }
    for (const doc of docFiles) {
      await guardarDocumento(doc, ref, req.body.rut, 'documento', t)
    }

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
    cleanupTempFiles(req)
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

  const page = Math.max(Number(req.query.page) || 1, 1)
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200)
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

// Sin columna de tipo en documentos: RRHH reconoce los certificados por este prefijo del nombre
const PREFIJO_CERTIFICADO = 'Certificado de estudio - '
const MAX_NOMBRE = 200 // largo de documentos.nombre

// Antepone el prefijo y recorta por el medio para no perder la extensión
function nombreConPrefijo(prefijo, original) {
  const nombre = prefijo + original
  if (nombre.length <= MAX_NOMBRE) return nombre
  const ext = path.extname(original).slice(0, 10)
  return nombre.slice(0, MAX_NOMBRE - ext.length) + ext
}

// Guarda un archivo como Documento ligado al referido.
// Sube a S3 si está configurado; si falla, deja la ruta local como fallback.
async function guardarDocumento(file, ref, rut, tipo, t, prefijoNombre = '') {
  let rutaFinal = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
  let s3Key = null
  if (useS3) {
    try {
      const fileContent = fs.readFileSync(file.path)
      s3Key = s3Service.generateReferidoFileKey(rut || 'sin-rut', ref.id, file.originalname, tipo)
      await s3Service.uploadFile(fileContent, s3Key, file.mimetype, {
        referidoId: String(ref.id),
        originalName: file.originalname,
        tipo,
      })
      rutaFinal = s3Key
      try { fs.unlinkSync(file.path) } catch {}
      console.log(`✅ ${tipo} subido a S3: ${s3Key}`)
    } catch (e) {
      // La key ya estaba asignada: sin esto la fila afirma estar en S3 y no lo está.
      s3Key = null
      logger.error('[postulaciones] Falló la subida a S3, queda solo copia local', {
        referidoId: ref.id, archivo: file.originalname, tipo, error: e.message,
      })
    }
  }

  await Documento().create({
    nombre: prefijoNombre ? nombreConPrefijo(prefijoNombre, file.originalname) : file.originalname,
    ruta: rutaFinal,
    s3Key,
    mimetype: file.mimetype,
    size: file.size,
    referidoId: ref.id,
  }, { transaction: t })
}

// Limpia los archivos temporales subidos si el flujo falla antes de procesarlos.
// Con uploader.fields() los archivos vienen en req.files (objeto de arrays por campo).
function cleanupTempFiles(req) {
  const grupos = req.files ? Object.values(req.files) : []
  for (const grupo of grupos) {
    for (const file of grupo) {
      if (file?.path) {
        try { fs.unlinkSync(file.path) } catch {}
      }
    }
  }
}

module.exports = { crear, crearValidators, listarMias }
