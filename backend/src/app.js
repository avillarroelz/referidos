// backend/src/app.js
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const routes = require('./routes')
const { config } = require('./config')
const { globalLimiter } = require('./middleware/rateLimiters')
const { UPLOAD_DIR, ensureDir } = require('./utils/files')

ensureDir(UPLOAD_DIR)

const app = express()

// Security
app.use(helmet())

// CORS configuration
const corsOrigins = config.corsOrigin
  ? config.corsOrigin.split(',').map(o => o.trim()).filter(o => o !== '*')
  : []

if (corsOrigins.length === 0) {
  console.warn('⚠️  SEGURIDAD: CORS_ORIGIN no configurado o es "*". En producción define orígenes específicos.')
}

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true)
    // Si no hay orígenes configurados (dev), permitir todo
    if (corsOrigins.length === 0) return callback(null, true)
    // Verificar contra lista blanca
    if (corsOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true
}))

// Rate limiting global
app.use('/api/', globalLimiter)

// Body parsing
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))

// Logging
app.use(morgan('dev'))

// Request logger custom
app.use(require('./middleware/requestLogger')())

// Static files (⚠️ en producción considera autenticación)
app.use('/uploads', express.static(UPLOAD_DIR))

// Routes
app.use('/api', routes)

// Error handler
app.use(require('./middleware/errorHandler').errorHandler)

module.exports = { app }