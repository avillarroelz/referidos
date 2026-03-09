// backend/src/routes/notificaciones.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const ctrl = require('../controllers/notificaciones.controller')

router.use(authRequired)

// GET /api/notificaciones — listar
router.get('/', ctrl.listar)

// GET /api/notificaciones/count — contar no leídas
router.get('/count', ctrl.contarNoLeidas)

// PATCH /api/notificaciones/leer-todas — marcar todas como leídas
router.patch('/leer-todas', ctrl.marcarTodasLeidas)

// PATCH /api/notificaciones/:id — marcar una como leída
router.patch('/:id', ctrl.marcarLeida)

module.exports = router
