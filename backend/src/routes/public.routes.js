// backend/src/routes/public.routes.js
const router = require('express').Router()
const { publicFormLimiter } = require('../middleware/rateLimiters')
const { uploader } = require('../middleware/upload')
const referidosCtrl = require('../controllers/publicReferidos.controller')
const postulacionesCtrl = require('../controllers/postulaciones.controller')

// POST /api/public/referidos — referir candidato (sin auth)
router.post('/referidos', publicFormLimiter, referidosCtrl.crearPublicoValidators, referidosCtrl.crearPublico)

// POST /api/public/postulaciones — postular sin sesión (con CV en PDF)
// Mismo controlador que el endpoint autenticado: detecta si hay req.auth o no.
router.post('/postulaciones',
  publicFormLimiter,
  uploader('postulaciones').single('cv'),
  postulacionesCtrl.crearValidators,
  postulacionesCtrl.crear
)

module.exports = router
