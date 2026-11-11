// backend/src/routes/gmail.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { heavyOpsLimiter, gmailBandejaLimiter } = require('../middleware/rateLimiters')
const {
  getAuthUrl,
  gmailOAuthCallback,
  getGmailStatus
} = require('../controllers/gmailController')

/**
 * GET /api/gmail/oauth2callback
 * Callback de OAuth2 de Gmail
 * Guarda el refresh_token centralizado y redirige al frontend
 */
router.get('/oauth2callback', gmailOAuthCallback)

// Todas las demás rutas requieren autenticación. El rate limit va por ruta:
// las que hablan con Google o guardan archivos usan el de operaciones pesadas,
// las consultas livianas de la bandeja usan el suyo.
router.use(authRequired)

/**
 * GET /api/gmail/status
 * Obtener estado de configuracion de Gmail
 * Requiere rol: ADMIN, RRHH o JefeRRHH
 */
router.get('/status', heavyOpsLimiter, requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), getGmailStatus)

/**
 * GET /api/gmail/auth-url
 * Obtener URL de autorización OAuth2
 * Requiere rol: ADMIN, RRHH o JefeRRHH
 */
// Los tres roles pueden conectar: el callback solo acepta la casilla de reclutamiento.
router.get('/auth-url', heavyOpsLimiter, requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), getAuthUrl)

// Bandeja: registro de correos revisados (importados / descartados).
const bandeja = require('../controllers/gmailBandeja.controller')
const GESTORES = ['RRHH', 'ADMIN', 'JefeRRHH']

router.post('/correos/descartar', gmailBandejaLimiter, requireRoles(...GESTORES), bandeja.descartarValidators, bandeja.descartar)
router.get('/correos/historial', gmailBandejaLimiter, requireRoles(...GESTORES), bandeja.historialValidators, bandeja.historial)
router.get('/correos/:messageId/adjuntos/:index', gmailBandejaLimiter, requireRoles(...GESTORES), bandeja.adjuntoValidators, bandeja.adjunto)
router.post('/correos/:messageId/adjuntar', heavyOpsLimiter, requireRoles(...GESTORES), bandeja.adjuntarValidators, bandeja.adjuntar)
router.delete('/correos/:messageId', gmailBandejaLimiter, requireRoles(...GESTORES), bandeja.restaurarValidators, bandeja.restaurar)

module.exports = router
