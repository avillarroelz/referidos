// backend/src/config.js
require('dotenv').config()

const isProd = process.env.NODE_ENV === 'production'

const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,
  corsOrigin: process.env.CORS_ORIGIN || '*',

  db: {
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT || 5432,
    user: process.env.DB_USER,
    pass: process.env.DB_PASS,
    name: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true',
    sslRejectUnauthorized: isProd ? true : process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    sslCaPath: process.env.DB_SSL_CA
  },

  // JWT — en producción DEBEN configurarse secrets fuertes y diferentes
  jwt: {
    secret: process.env.JWT_SECRET || 'devsecret-change-me-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '20m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'devrefresh-change-me-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    algorithm: 'HS256'
  },
  
  // Admin
  syncDb: process.env.SYNC_DB === 'true',
  seedAdmin: process.env.SEED_ADMIN === 'true',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@local',
  adminPass: process.env.ADMIN_PASS || 'admin123',
  
  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 1000
  },

  // SLA
  sla: {
    adcResponseDays: parseInt(process.env.SLA_ADC_RESPONSE_DAYS) || 3,
  },

  // Formulario público
  publicForm: {
    rateLimitMax: parseInt(process.env.PUBLIC_FORM_RATE_LIMIT) || 5,
  },

  // Anthropic API (parser IA de correos)
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
  },
}

module.exports = { config }