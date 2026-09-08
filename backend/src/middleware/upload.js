const multer = require('multer')
const path = require('path')
const { UPLOAD_DIR, ensureDir, safeName } = require('../utils/files')

function storageFor(subfolder) {
  return multer.diskStorage({
    destination: function (_req, _file, cb) {
      const dir = ensureDir(path.join(UPLOAD_DIR, subfolder))
      cb(null, dir)
    },
    filename: function (_req, file, cb) {
      const ts = Date.now()
      cb(null, `${ts}-${safeName(file.originalname)}`)
    }
  })
}

const ALLOWED_EXTENSIONS = /\.(pdf|doc|docx|jpg|jpeg|png)$/i

const MAX_FILE_SIZE = 10 * 1024 * 1024
const limits = { fileSize: MAX_FILE_SIZE }

const MSG_TIPO_NO_PERMITIDO = 'Tipo de archivo no permitido. Solo se aceptan: PDF, Word e imágenes (JPG/PNG).'

const fileFilter = (_req, file, cb) => {
  // whitelist de tipos MIME + extensión (doble validación como backendDesv)
  const allowedMimeTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  ]
  const mimeOk = allowedMimeTypes.includes(file.mimetype)
  const extOk = ALLOWED_EXTENSIONS.test(file.originalname)
  const ok = mimeOk && extOk

  if (ok) return cb(null, true)

  const err = new Error(MSG_TIPO_NO_PERMITIDO)
  err.status = 400
  cb(err, false)
}

/**
 * Traduce los errores de multer a respuestas de cliente. Sin esto el rechazo de
 * una entrada invalida sale como 500 —le dice al cliente que fallo el servidor
 * cuando en realidad se rechazo su archivo a proposito— y ademas filtra el
 * mensaje interno de la libreria en rutas publicas sin autenticar.
 */
function conErroresDeCliente(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next()

      if (err instanceof multer.MulterError) {
        const traducciones = {
          LIMIT_FILE_SIZE: { status: 413, error: `El archivo supera el máximo de ${MAX_FILE_SIZE / (1024 * 1024)}MB.` },
          LIMIT_FILE_COUNT: { status: 400, error: 'Se enviaron más archivos de los permitidos.' },
          LIMIT_UNEXPECTED_FILE: { status: 400, error: 'Se recibió un archivo en un campo no esperado.' },
        }
        const t = traducciones[err.code] || { status: 400, error: 'No se pudo procesar el archivo enviado.' }
        return res.status(t.status).json({ error: t.error })
      }

      // Error del fileFilter: ya trae su propio status y un mensaje para el usuario
      if (err.status) return res.status(err.status).json({ error: err.message })

      next(err)
    })
  }
}

function uploader(subfolder) {
  const instancia = multer({ storage: storageFor(subfolder), limits, fileFilter })
  return {
    array: (...args) => conErroresDeCliente(instancia.array(...args)),
    fields: (...args) => conErroresDeCliente(instancia.fields(...args)),
    single: (...args) => conErroresDeCliente(instancia.single(...args)),
  }
}

module.exports = { uploader }
