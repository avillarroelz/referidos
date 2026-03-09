// backend/src/middleware/rateLimiters.js
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const { config } = require('../config')

// Key generator para rutas autenticadas: usa user.id si existe, fallback a IP
const keyByUser = (req) => (req.user?.id ? `user:${req.user.id}` : ipKeyGenerator(req.ip))

// Capa 1 — Global: protección contra abuso masivo (por IP, default)
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { error: 'Demasiadas peticiones, intenta más tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Capa 2a — Auth Login: prevenir brute force (10 intentos / 15 min, por IP)
const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Capa 2b — Auth Register: prevenir spam de cuentas (5 intentos / 60 min, por IP)
const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos de registro. Espera unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Capa 3 — Operaciones pesadas: Gmail sync, IA, APIs externas (10 req / 15 min, por usuario)
const heavyOpsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: keyByUser,
  message: { error: 'Demasiadas operaciones pesadas. Espera unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Formulario público: 5 req / 15 min (por IP, default)
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.publicForm.rateLimitMax,
  message: { error: 'Demasiados envíos. Intenta de nuevo en unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = {
  globalLimiter,
  authLoginLimiter,
  authRegisterLimiter,
  heavyOpsLimiter,
  publicFormLimiter,
}
