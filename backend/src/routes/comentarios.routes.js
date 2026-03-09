// backend/src/routes/comentarios.routes.js
const router = require('express').Router({ mergeParams: true })
const ctrl = require('../controllers/comentarios.controller')

// GET /api/referidos/:id/comentarios
router.get('/', ctrl.listar)

// POST /api/referidos/:id/comentarios
router.post('/', ctrl.crearValidators, ctrl.crear)

module.exports = router
