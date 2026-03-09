// backend/src/routes/adjuntos.routes.js
const router = require('express').Router({ mergeParams: true })
const { authRequired, requireRoles } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/adjuntos.controller')

// Todas requieren login
router.use(authRequired)

// Listar
router.get('/', requireRoles('TRABAJADOR','RRHH','ADMIN'), ctrl.idValidators, ctrl.list)

// Subir múltiples (campo "files")
router.post('/',
  requireRoles('TRABAJADOR','RRHH','ADMIN'),
  ctrl.idValidators,
  uploader(`referidos`).array('files', 10),
  ctrl.upload
)

// Descargar
router.get('/:docId/download', requireRoles('TRABAJADOR','RRHH','ADMIN'), ctrl.delValidators, ctrl.download)

// Eliminar
router.delete('/:docId', requireRoles('RRHH','ADMIN'), ctrl.delValidators, ctrl.remove)

module.exports = router
