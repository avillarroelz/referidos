// backend/src/routes/index.js
const router = require('express').Router()

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'tracking-referidos', ts: new Date().toISOString() })
})

router.use('/auth', require('./auth.routes'))
router.use('/roles', require('./roles.routes'))
router.use('/lineas', require('./linea.routes'))
router.use('/unidades', require('./unidades.routes'))
router.use('/personas', require('./personas.routes'))
router.use('/referidos', require('./referidos.routes'))
router.use('/postulaciones', require('./postulaciones.routes'))
router.use('/kpis', require('./kpis.routes'))
router.use('/gmail', require('./gmail.routes'))
router.use('/notificaciones', require('./notificaciones.routes'))
router.use('/feedback', require('./feedback.routes'))
router.use('/public', require('./public.routes'))
router.use('/integracion', require('./integracion.routes'))

module.exports = router
