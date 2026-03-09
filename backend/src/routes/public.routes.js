// backend/src/routes/public.routes.js
const router = require('express').Router()
const { publicFormLimiter } = require('../middleware/rateLimiters')
const ctrl = require('../controllers/publicReferidos.controller')

// POST /api/public/referidos — sin autenticación
router.post('/referidos', publicFormLimiter, ctrl.crearPublicoValidators, ctrl.crearPublico)

module.exports = router
