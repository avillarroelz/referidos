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

const limits = { fileSize: 10 * 1024 * 1024 } // 10MB
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
  cb(ok ? null : new Error('Tipo de archivo no permitido. Solo se aceptan: PDF, Word e imágenes (JPG/PNG).'), ok)
}

function uploader(subfolder) {
  return multer({ storage: storageFor(subfolder), limits, fileFilter })
}

module.exports = { uploader }
