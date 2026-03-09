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

const limits = { fileSize: 10 * 1024 * 1024 } // 10MB
const fileFilter = (_req, file, cb) => {
  // whitelist de tipos de archivo permitidos
  const allowedMimeTypes = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  ]
  const ok = allowedMimeTypes.includes(file.mimetype)
  cb(ok ? null : new Error('Tipo de archivo no permitido'), ok)
}

function uploader(subfolder) {
  return multer({ storage: storageFor(subfolder), limits, fileFilter })
}

module.exports = { uploader }
