// backend/src/routes/referidos.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { requireInterno } = require('../lib/acceso')
const { heavyOpsLimiter } = require('../middleware/rateLimiters')
const ctrl = require('../controllers/referidos.controller')

// Todas requieren login
router.use(authRequired)

// Crear — cualquier rol interno agrega un referido; EXTERNO no (solo postula)
router.post('/', requireInterno, ctrl.createValidators, ctrl.create)

// Listar (cualquier autenticado) – el controller aplica permisos
router.get('/', ctrl.listValidators, ctrl.list)

// Stats rápidas del usuario (conteos por estado)
router.get('/stats', ctrl.getStats)

// Listar usuarios con rol ADC (para select de asignación) — ANTES de /:id
router.get('/adc-usuarios', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), ctrl.listarADCUsuarios)

// Listar referidos asignados al ADC autenticado — ANTES de /:id
router.get('/mis-asignados', requireRoles('ADC'), ctrl.listarParaADC)

// Detalle
router.get('/:id', ctrl.getValidators, ctrl.getById)

// Historial del referido
router.get('/:id/historial', ctrl.getValidators, ctrl.getHistorial)

// Cambiar estado (RRHH, JefeRRHH o ADMIN)
router.patch('/:id/estado', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), ctrl.changeValidators, ctrl.changeState)

// Compatibilidad POST
router.post('/:id/estado', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), ctrl.changeValidators, ctrl.changeState)

// Marcar como enviado a ADC (RRHH, JefeRRHH o ADMIN) — legacy
router.patch('/:id/adc', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), ctrl.enviarADCValidators, ctrl.enviarADC)

// Asignar a ADC específico (RRHH, JefeRRHH o ADMIN)
router.patch('/:id/asignar-adc', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), ctrl.asignarADCValidators, ctrl.asignarADC)

// Dictamen ADC (solo ADC)
router.patch('/:id/dictamen', requireRoles('ADC'), ctrl.dictaminarValidators, ctrl.dictaminar)

// Sincronizar referidos desde Gmail (RRHH, JefeRRHH o ADMIN)
router.post('/sync/gmail', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), heavyOpsLimiter, ctrl.syncGmailValidators, ctrl.syncFromGmail)

// Preview de correos de Gmail via SSE (RRHH, JefeRRHH o ADMIN)
router.get('/sync/gmail/preview', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), heavyOpsLimiter, ctrl.previewGmailValidators, ctrl.previewGmail)

// Importar referidos editados manualmente desde Gmail (RRHH, JefeRRHH o ADMIN)
router.post('/sync/gmail/manual', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), heavyOpsLimiter, ctrl.syncGmailManualValidators, ctrl.syncFromGmailManual)

// Adjuntos (rutas anidadas)
router.use('/:id/adjuntos', require('./adjuntos.routes'))

// Comentarios (rutas anidadas)
router.use('/:id/comentarios', require('./comentarios.routes'))

module.exports = router
