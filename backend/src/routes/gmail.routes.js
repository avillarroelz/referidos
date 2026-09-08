// backend/src/routes/gmail.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { heavyOpsLimiter } = require('../middleware/rateLimiters')
const {
  processGmailReferidos,
  previewGmailReferidos,
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

// Todas las demás rutas requieren autenticación + rate limit para ops pesadas
router.use(authRequired)
router.use(heavyOpsLimiter)

/**
 * GET /api/gmail/status
 * Obtener estado de configuracion de Gmail
 * Requiere rol: ADMIN o RRHH
 */
router.get('/status', requireRoles('RRHH', 'ADMIN'), getGmailStatus)

/**
 * POST /api/gmail/process
 * Procesar correos de Gmail y crear referidos
 * Requiere rol: ADMIN o RRHH
 */
router.post('/process', requireRoles('RRHH', 'ADMIN'), processGmailReferidos)

/**
 * POST /api/gmail/preview
 * Vista previa de correos sin procesarlos
 * Requiere rol: ADMIN o RRHH
 */
router.post('/preview', requireRoles('RRHH', 'ADMIN'), previewGmailReferidos)

/**
 * GET /api/gmail/auth-url
 * Obtener URL de autorización OAuth2
 * Requiere rol: ADMIN o RRHH
 */
router.get('/auth-url', requireRoles('RRHH', 'ADMIN'), getAuthUrl)

module.exports = router
