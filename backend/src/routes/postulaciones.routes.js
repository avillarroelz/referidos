// backend/src/routes/postulaciones.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/postulaciones.controller')

// Crear postulación autenticada (queda ligada a postulanteUserId)
// Campos de archivo: 'cv' (PDF obligatorio), 'certificados' (1 a 3 PDF obligatorios) y 'documentos' (hasta 20 PDF opcionales)
router.post('/',
  authRequired,
  uploader('postulaciones').fields([
    { name: 'cv', maxCount: 1 },
    { name: 'certificados', maxCount: 3 },
    { name: 'documentos', maxCount: 20 },
  ]),
  ctrl.crearValidators,
  ctrl.crear
)

// Listar las postulaciones del usuario autenticado
router.get('/mias', authRequired, ctrl.listarMias)

module.exports = router
