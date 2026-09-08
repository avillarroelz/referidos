// backend/src/routes/auth.routes.js
const router = require('express').Router()
const { authRequired } = require('../middleware/auth')
const { authLoginLimiter, authLoginIpLimiter, authRegisterLimiter, authRefreshLimiter } = require('../middleware/rateLimiters')
const {
  login, loginValidators,
  register, registerValidators,
  refresh, me, logout,
  changePassword, changePasswordValidators,
  forgotPassword, forgotPasswordValidators,
  resetPassword, resetPasswordValidators,
  googleLogin, googleCallback,
  updateMe, updateMeValidators,
} = require('../controllers/auth.controller')

// Rutas públicas (cada una con su rate limiter)
router.post('/login', authLoginIpLimiter, authLoginLimiter, loginValidators, login)
router.post('/register', authRegisterLimiter, registerValidators, register)
router.post('/refresh', authRefreshLimiter, refresh)
router.post('/logout', logout)
router.post('/forgot-password', authRefreshLimiter, forgotPasswordValidators, forgotPassword)
router.post('/reset-password', authRefreshLimiter, resetPasswordValidators, resetPassword)

// Google OAuth
router.get('/google', googleLogin)
router.get('/google/callback', googleCallback)

// Rutas protegidas
router.get('/me', authRequired, me)
router.patch('/me', authRequired, updateMeValidators, updateMe)
router.post('/change-password', authRequired, changePasswordValidators, changePassword)

module.exports = router
