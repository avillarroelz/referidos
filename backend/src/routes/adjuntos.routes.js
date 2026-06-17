// backend/src/routes/adjuntos.routes.js
const router = require('express').Router({ mergeParams: true })
const { authRequired, requireRoles } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/adjuntos.controller')

// Todas requieren login
router.use(authRequired)

// Listar (EXTERNO solo accede a los suyos por assertReferidoAccess)
router.get('/', requireRoles('TRABAJADOR','RRHH','ADMIN','EXTERNO'), ctrl.idValidators, ctrl.list)

// Subir múltiples (campo "files")
router.post('/',
  requireRoles('TRABAJADOR','RRHH','ADMIN','EXTERNO'),
  ctrl.idValidators,
  uploader(`referidos`).array('files', 10),
  ctrl.upload
)

// Descargar
router.get('/:docId/download', requireRoles('TRABAJADOR','RRHH','ADMIN','EXTERNO'), ctrl.delValidators, ctrl.download)

// Eliminar (EXTERNO puede borrar los de su propia postulación)
router.delete('/:docId', requireRoles('RRHH','ADMIN','EXTERNO'), ctrl.delValidators, ctrl.remove)

module.exports = router
