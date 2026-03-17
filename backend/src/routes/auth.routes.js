// backend/src/routes/auth.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const { authLoginLimiter, authRegisterLimiter } = require('../middleware/rateLimiters')
const {
  login,
  loginValidators,
  register,
  registerValidators,
  refresh,
  refreshValidators,
  me,
  googleLogin,
  googleCallback,
  googleExchange
} = require('../controllers/auth.controller')

// Rutas públicas (con rate limiting estricto)
router.post('/login', authLoginLimiter, loginValidators, login)
router.post('/register', authRegisterLimiter, registerValidators, register)
router.post('/refresh', authLoginLimiter, refreshValidators, refresh)

// Rutas de Google OAuth
router.get('/google', googleLogin)
router.get('/google/callback', googleCallback)
router.post('/google/exchange', googleExchange)

// Rutas protegidas
router.get('/me', authRequired, me)

module.exports = router