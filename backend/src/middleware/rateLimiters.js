// backend/src/middleware/rateLimiters.js
// Rate limiting basado en patrones probados de backendDesv (WebEcora)
const { rateLimit, ipKeyGenerator } = require('express-rate-limit')
const { config } = require('../config')

// ──────────────────────────────────────────────────────────────
// Capa 1 — Global: protección contra abuso masivo
// Exime rutas de alta frecuencia para usuarios autenticados
// ──────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    error: 'Demasiadas peticiones. Por favor intenta más tarde.',
    code: 'TOO_MANY_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Nota: montado en /api/, así que req.path es relativo (ej: /auth/me)
    const isHighFrequencyRoute =
      req.path.startsWith('/referidos') ||
      req.path.startsWith('/kpis') ||
      req.path.startsWith('/notificaciones')

    const hasAuthToken =
      req.headers.authorization?.startsWith('Bearer ') ||
      !!req.cookies?.__access_token

    return (
      req.path === '/health' ||
      req.path === '/csrf-token' ||
      req.path.startsWith('/auth/') ||
      (isHighFrequencyRoute && hasAuthToken)
    )
  },
})

// ──────────────────────────────────────────────────────────────
// Capa 2a — Login: brute force por EMAIL (no por IP)
// Evita que una oficina con NAT se bloquee entera
// ──────────────────────────────────────────────────────────────
const authLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.correo?.toLowerCase()?.trim()
    // ipKeyGenerator recibe la IP en texto: pasarle el `req` colapsa todas las
    // peticiones a una unica clave compartida entre IPs distintas.
    return email ? `login:${email}` : `login:ip:${ipKeyGenerator(req.ip)}`
  },
  handler: (_req, res) => {
    const retryAfter = res.getHeader('Retry-After') || 900
    const resetTime = res.getHeader('RateLimit-Reset')
    res.status(429).json({
      error: 'Demasiados intentos de login fallidos.',
      message: 'Has excedido el número máximo de intentos para este correo. Por favor espera antes de volver a intentar.',
      code: 'TOO_MANY_REQUESTS',
      retryAfterSeconds: Number(retryAfter),
      unlockTime: resetTime ? new Date(Number(resetTime) * 1000).toISOString() : null,
    })
  },
})

// ──────────────────────────────────────────────────────────────
// Capa 2a-bis — Login: techo por IP, ADEMAS del de correo
// El de correo frena la fuerza bruta contra UNA cuenta, pero deja pasar el
// password spraying: una misma IP probando una clave comun contra miles de
// correos nunca agota un contador por correo, y globalLimiter exime /auth/.
// El limite es holgado a proposito (una oficina tras NAT comparte IP) y los
// aciertos no gastan cuota, asi que solo lo alcanza quien acumula fallos.
// ──────────────────────────────────────────────────────────────
const authLoginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `login:ip:${ipKeyGenerator(req.ip)}`,
  handler: (_req, res) => {
    const retryAfter = res.getHeader('Retry-After') || 900
    res.status(429).json({
      error: 'Demasiados intentos de login fallidos desde esta red.',
      message: 'Se han acumulado demasiados intentos fallidos. Espera antes de volver a intentar.',
      code: 'TOO_MANY_REQUESTS',
      retryAfterSeconds: Number(retryAfter),
    })
  },
})

// ──────────────────────────────────────────────────────────────
// Capa 2b — Register: prevenir spam de cuentas (5 / 60 min)
// ──────────────────────────────────────────────────────────────
const authRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: {
    error: 'Demasiados intentos de registro. Espera unos minutos.',
    code: 'TOO_MANY_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// ──────────────────────────────────────────────────────────────
// Capa 2c — Refresh: separado del login (20 / 15 min)
// Un refresh NO debe consumir intentos de login
// ──────────────────────────────────────────────────────────────
const authRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: {
    error: 'Demasiadas renovaciones de token. Espera unos minutos.',
    code: 'TOO_MANY_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// ──────────────────────────────────────────────────────────────
// Capa 3 — Operaciones pesadas: Gmail sync, IA, APIs externas
// ──────────────────────────────────────────────────────────────
const heavyOpsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req.auth?.id ? `heavy:${req.auth.id}` : ipKeyGenerator(req.ip)),
  message: {
    error: 'Demasiadas operaciones pesadas. Espera unos minutos.',
    code: 'TOO_MANY_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// ──────────────────────────────────────────────────────────────
// Formulario público: 5 / 15 min (por IP)
// ──────────────────────────────────────────────────────────────
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.publicForm.rateLimitMax,
  message: {
    error: 'Demasiados envíos. Intenta de nuevo en unos minutos.',
    code: 'TOO_MANY_REQUESTS',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = {
  globalLimiter,
  authLoginLimiter,
  authLoginIpLimiter,
  authRegisterLimiter,
  authRefreshLimiter,
  heavyOpsLimiter,
  publicFormLimiter,
}
