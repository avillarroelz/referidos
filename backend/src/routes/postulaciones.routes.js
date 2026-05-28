// backend/src/routes/postulaciones.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/postulaciones.controller')

// Crear postulación autenticada (queda ligada a postulanteUserId)
// Campo del PDF: 'cv'
router.post('/',
  authRequired,
  uploader('postulaciones').single('cv'),
  ctrl.crearValidators,
  ctrl.crear
)

// Listar las postulaciones del usuario autenticado
router.get('/mias', authRequired, ctrl.listarMias)

module.exports = router
