// backend/src/routes/gmail.routes.js
const router = require('express').Router()
const { authRequired, requireRoles } = require('../middleware/auth')
const { heavyOpsLimiter } = require('../middleware/rateLimiters')
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

// Todas las demás rutas requieren autenticación + rate limit para ops pesadas
router.use(authRequired)
router.use(heavyOpsLimiter)

/**
 * GET /api/gmail/status
 * Obtener estado de configuracion de Gmail
 * Requiere rol: ADMIN, RRHH o JefeRRHH
 */
router.get('/status', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), getGmailStatus)

/**
 * GET /api/gmail/auth-url
 * Obtener URL de autorización OAuth2
 * Requiere rol: ADMIN, RRHH o JefeRRHH
 */
// Los tres roles pueden conectar: el callback solo acepta la casilla de reclutamiento.
router.get('/auth-url', requireRoles('RRHH', 'ADMIN', 'JefeRRHH'), getAuthUrl)

module.exports = router
