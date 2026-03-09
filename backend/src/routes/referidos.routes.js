// backend/src/routes/referidos.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { heavyOpsLimiter } = require('../middleware/rateLimiters')
const ctrl = require('../controllers/referidos.controller')

// Todas requieren login
router.use(authRequired)

// Crear (cualquier autenticado)
router.post('/', ctrl.createValidators, ctrl.create)

// Listar (cualquier autenticado) – el controller aplica permisos
router.get('/', ctrl.listValidators, ctrl.list)

// Stats rápidas del usuario (conteos por estado)
router.get('/stats', ctrl.getStats)

// Listar usuarios con rol ADC (para select de asignación) — ANTES de /:id
router.get('/adc-usuarios', requireRoles('RRHH', 'ADMIN'), ctrl.listarADCUsuarios)

// Listar referidos asignados al ADC autenticado — ANTES de /:id
router.get('/mis-asignados', requireRoles('ADC'), ctrl.listarParaADC)

// Detalle
router.get('/:id', ctrl.getValidators, ctrl.getById)

// Historial del referido
router.get('/:id/historial', ctrl.getValidators, ctrl.getHistorial)

// Cambiar estado (solo RRHH o ADMIN)
router.patch('/:id/estado', requireRoles('RRHH', 'ADMIN'), ctrl.changeValidators, ctrl.changeState)

// Compatibilidad POST
router.post('/:id/estado', requireRoles('RRHH', 'ADMIN'), ctrl.changeValidators, ctrl.changeState)

// Marcar como enviado a ADC (solo RRHH o ADMIN) — legacy
router.patch('/:id/adc', requireRoles('RRHH', 'ADMIN'), ctrl.enviarADCValidators, ctrl.enviarADC)

// Asignar a ADC específico (solo RRHH o ADMIN)
router.patch('/:id/asignar-adc', requireRoles('RRHH', 'ADMIN'), ctrl.asignarADCValidators, ctrl.asignarADC)

// Dictamen ADC (solo ADC)
router.patch('/:id/dictamen', requireRoles('ADC'), ctrl.dictaminarValidators, ctrl.dictaminar)

// Sincronizar referidos desde Gmail (solo RRHH o ADMIN)
router.post('/sync/gmail', heavyOpsLimiter, ctrl.syncGmailValidators, ctrl.syncFromGmail)

// Preview de correos de Gmail via SSE (solo RRHH o ADMIN)
router.get('/sync/gmail/preview', heavyOpsLimiter, ctrl.previewGmailValidators, ctrl.previewGmail)

// Importar referidos editados manualmente desde Gmail (solo RRHH o ADMIN)
router.post('/sync/gmail/manual', heavyOpsLimiter, ctrl.syncGmailManualValidators, ctrl.syncFromGmailManual)

// Adjuntos (rutas anidadas)
router.use('/:id/adjuntos', require('./adjuntos.routes'))

// Comentarios (rutas anidadas)
router.use('/:id/comentarios', require('./comentarios.routes'))

module.exports = router
