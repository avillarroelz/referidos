// backend/src/routes/feedback.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { uploader } = require('../middleware/upload')
const ctrl = require('../controllers/feedback.controller')

// Crear reporte (cualquier usuario interno autenticado). Hasta 5 imágenes opcionales.
router.post('/',
  authRequired,
  uploader('feedback').array('imagenes', 5),
  ctrl.crearValidators,
  ctrl.crear
)

// Gestión: solo ADMIN
router.get('/', authRequired, requireRoles('ADMIN'), ctrl.listar)
router.get('/pendientes/count', authRequired, requireRoles('ADMIN'), ctrl.contarPendientes)
router.patch('/:id/estado', authRequired, requireRoles('ADMIN'), ctrl.estadoValidators, ctrl.cambiarEstado)
router.get('/:id/imagenes/:idx', authRequired, requireRoles('ADMIN'), ctrl.obtenerImagen)

module.exports = router
