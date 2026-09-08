// backend/src/controllers/adjuntos.controller.js
const path = require('path')
const fs = require('fs')
const { param, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { UPLOAD_DIR } = require('../utils/files')
const s3Service = require('../services/s3Service')
const { assertReferidoAccess } = require('../lib/acceso')

const Referido = getModel('Referido')
const Documento = getModel('Documento')
const Usuario = getModel('Usuario')

// Verificar si S3 está configurado
const useS3 = s3Service.isConfigured()

const idValidators = [ param('id').isInt({ gt: 0 }) ]

async function list(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const ref = await Referido.findByPk(id, { include: [{ model: Documento, as: 'adjuntos' }] })
  if (!ref) return res.status(404).json({ error: 'Referido no encontrado' })
  if (!(await assertReferidoAccess(req, res, ref))) return
  res.json(ref.adjuntos || [])
}

async function upload(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const ref = await Referido.findByPk(id)
  if (!ref) return res.status(404).json({ error: 'Referido no encontrado' })
  if (!(await assertReferidoAccess(req, res, ref))) return

  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Sin archivos' })

  const docs = []

  for (const file of req.files) {
    let rutaFinal = path.relative(process.cwd(), file.path).replace(/\\/g, '/')
    let s3Key = null

    // Si S3 está configurado, subir a S3
    if (useS3) {
      try {
        console.log(`📤 Subiendo ${file.originalname} a S3...`)

        // Leer el archivo del disco temporal
        const fileContent = fs.readFileSync(file.path)

        // Generar key único en S3 usando RUT del referido
        s3Key = s3Service.generateReferidoFileKey(ref.rut || 'sin-rut', id, file.originalname, 'documento')

        // Subir a S3
        const uploadResult = await s3Service.uploadFile(
          fileContent,
          s3Key,
          file.mimetype,
          {
            referidoId: String(id),
            originalName: file.originalname
          }
        )

        console.log(`✅ Archivo subido a S3: ${s3Key}`)

        // Usar el key de S3 como ruta
        rutaFinal = s3Key

        // Eliminar archivo temporal del disco
        try {
          fs.unlinkSync(file.path)
        } catch (e) {
          console.warn('No se pudo eliminar archivo temporal:', e.message)
        }
      } catch (error) {
        console.error('❌ Error subiendo a S3:', error)
        // Si falla S3, guardar localmente como fallback
        console.warn('⚠️ Fallback: guardando archivo localmente')
      }
    }

    // Crear registro en BD
    const doc = await Documento.create({
      nombre: file.originalname,
      ruta: rutaFinal,
      s3Key: s3Key,
      mimetype: file.mimetype,
      size: file.size,
      referidoId: id,
    })

    docs.push(doc)
  }

  res.status(201).json({
    ok: true,
    count: docs.length,
    adjuntos: docs,
    storage: useS3 ? 's3' : 'local'
  })
}

const delValidators = [
  param('id').isInt({ gt: 0 }),
  param('docId').isInt({ gt: 0 }),
]

async function remove(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { id, docId } = { id: +req.params.id, docId: +req.params.docId }
  const ref = await Referido.findByPk(id)
  if (!ref) return res.status(404).json({ error: 'Referido no encontrado' })
  if (!(await assertReferidoAccess(req, res, ref))) return
  const doc = await Documento.findOne({ where: { id: docId, referidoId: id } })
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  // Si tiene s3Key, eliminar de S3
  if (doc.s3Key && useS3) {
    try {
      console.log(`🗑️ Eliminando de S3: ${doc.s3Key}`)
      await s3Service.deleteFile(doc.s3Key)
      console.log(`✅ Archivo eliminado de S3`)
    } catch (error) {
      console.error('❌ Error eliminando de S3:', error)
      // Continuar con la eliminación del registro aunque falle S3
    }
  } else {
    // Si es archivo local, eliminarlo del disco
    const abs = path.join(process.cwd(), doc.ruta)
    try {
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs)
        console.log(`✅ Archivo local eliminado: ${abs}`)
      }
    } catch (e) {
      console.warn('⚠️ No se pudo eliminar archivo local:', e.message)
    }
  }

  await doc.destroy()
  res.json({ ok: true })
}

async function download(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { id, docId } = { id: +req.params.id, docId: +req.params.docId }
  const ref = await Referido.findByPk(id)
  if (!ref) return res.status(404).json({ error: 'Referido no encontrado' })
  if (!(await assertReferidoAccess(req, res, ref))) return
  const doc = await Documento.findOne({ where: { id: docId, referidoId: id } })
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' })

  try {
    // Si tiene s3Key, generar URL firmada de S3
    if (doc.s3Key && useS3) {
      console.log(`📥 Generando URL de descarga para: ${doc.s3Key}`)
      const signedUrl = await s3Service.getSignedDownloadUrl(doc.s3Key, 300) // 5 minutos

      // Redirigir a la URL firmada de S3
      return res.redirect(signedUrl)
    } else {
      // Si es archivo local, enviarlo desde el disco
      const abs = path.join(process.cwd(), doc.ruta)
      if (!fs.existsSync(abs)) {
        return res.status(404).json({ error: 'Archivo no encontrado en el servidor' })
      }

      res.setHeader('Content-Disposition', `attachment; filename="${doc.nombre}"`)
      res.setHeader('Content-Type', doc.mimetype || 'application/octet-stream')
      return res.sendFile(abs)
    }
  } catch (error) {
    console.error('❌ Error descargando archivo:', error)
    return res.status(500).json({ error: 'Error al descargar el archivo' })
  }
}

module.exports = { list, upload, remove, download, idValidators, delValidators }
