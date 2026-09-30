// backend/src/routes/comentarios.routes.js
const router = require('express').Router({ mergeParams: true })
const { authRequired, requireRoles } = require('../middleware/auth')
const ctrl = require('../controllers/comentarios.controller')

router.use(authRequired)

// Lista blanca a proposito (decision 30-09): los comentarios son de la gestion
// interna, asi que TRABAJADOR (incluso creador) y EXTERNO quedan fuera. La
// relacion (ADC solo el asignado) se valida en el controller.
router.use(requireRoles('RRHH', 'JefeRRHH', 'ADMIN', 'ADC'))

// GET /api/referidos/:id/comentarios
router.get('/', ctrl.listar)

// POST /api/referidos/:id/comentarios
router.post('/', ctrl.crearValidators, ctrl.crear)

module.exports = router
