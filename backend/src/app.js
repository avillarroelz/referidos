// backend/src/app.js
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const cookieParser = require('cookie-parser')
const { doubleCsrf } = require('csrf-csrf')
const routes = require('./routes')
const { config } = require('./config')
const { globalLimiter } = require('./middleware/rateLimiters')
const { UPLOAD_DIR, ensureDir } = require('./utils/files')

ensureDir(UPLOAD_DIR)

const app = express()

// ─── Trust Proxy (para IP real detrás de load balancer/nginx) ─
app.set('trust proxy', true)

// ─── Security Headers (Helmet + CSP) ──────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: config.isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))

// ─── CORS ─────────────────────────────────────────────────────
const corsOrigins = config.corsOrigin
  ? config.corsOrigin.split(',').map(o => o.trim()).filter(o => o !== '*')
  : []

if (corsOrigins.length === 0) {
  console.warn('⚠️  SEGURIDAD: CORS_ORIGIN no configurado o es "*". En producción define orígenes específicos.')
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (corsOrigins.length === 0) return callback(null, true)
    if (corsOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400,
}))

// ─── Cookie Parser ────────────────────────────────────────────
app.use(cookieParser())

// ─── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// ─── CSRF Protection (double-submit cookie) ───────────────────
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.jwt.secret,
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: config.isProd ? 'strict' : 'lax',
    secure: config.isProd,
    path: '/',
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
})

// Endpoint para obtener CSRF token
app.get('/api/csrf-token', (req, res) => {
  const token = generateToken(req, res)
  res.json({ csrfToken: token })
})

// Aplicar CSRF a rutas que modifican estado (excluir auth y public)
app.use('/api', (req, res, next) => {
  const skipPaths = ['/auth/', '/public/', '/csrf-token', '/health', '/integracion/']
  const skipMethods = ['GET', 'HEAD', 'OPTIONS']
  if (skipMethods.includes(req.method) || skipPaths.some(p => req.path.startsWith(p))) {
    return next()
  }
  doubleCsrfProtection(req, res, next)
})

// ─── Rate limiting global ─────────────────────────────────────
app.use('/api/', globalLimiter)

// ─── Logging ──────────────────────────────────────────────────
app.use(morgan(config.isProd ? 'combined' : 'dev'))
app.use(require('./middleware/requestLogger')())

// ─── Static files ─────────────────────────────────────────────
app.use('/uploads', express.static(UPLOAD_DIR))

// ─── Routes ───────────────────────────────────────────────────
app.use('/api', routes)

// ─── Error handler ────────────────────────────────────────────
app.use(require('./middleware/errorHandler').errorHandler)

module.exports = { app }