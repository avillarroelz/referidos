// backend/src/routes/auth.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const { authLoginLimiter, authRegisterLimiter, authRefreshLimiter } = require('../middleware/rateLimiters')
const {
  login,
  loginValidators,
  register,
  registerValidators,
  refresh,
  me,
  logout,
  googleLogin,
  googleCallback,
} = require('../controllers/auth.controller')

// Rutas públicas (cada una con su rate limiter específico)
router.post('/login', authLoginLimiter, loginValidators, login)
router.post('/register', authRegisterLimiter, registerValidators, register)
router.post('/refresh', authRefreshLimiter, refresh)
router.post('/logout', logout)

// Rutas de Google OAuth
router.get('/google', googleLogin)
router.get('/google/callback', googleCallback)

// Rutas protegidas
router.get('/me', authRequired, me)

module.exports = router
