// backend/src/utils/logger.js
// Logger estructurado con Winston (patrón backendDesv)
const winston = require('winston')
require('winston-daily-rotate-file')
const path = require('path')

const isProd = process.env.NODE_ENV === 'production'
const LOG_DIR = path.join(__dirname, '../../logs')

// Formato para desarrollo (legible y con colores)
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : ''
    return `${timestamp} ${level}: ${message}${metaStr}`
  })
)

// Formato para producción (JSON estructurado)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json()
)

const transports = [
  new winston.transports.Console({
    format: isProd ? prodFormat : devFormat,
  }),
]

// En producción: archivos con rotación diaria
if (isProd) {
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      level: 'error',
      datePattern: 'YYYY-MM-DD',
      maxSize: '5m',
      maxFiles: '30d',
      format: prodFormat,
    }),
    new winston.transports.DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '14d',
      format: prodFormat,
    })
  )
}

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  transports,
})

// Helper para eventos de seguridad (siempre se loguean)
function logSecurityEvent(event, details = {}) {
  logger.warn({
    message: `[SECURITY] ${event}`,
    type: 'security',
    event,
    ...details,
    timestamp: new Date().toISOString(),
  })
}

module.exports = { logger, logSecurityEvent }
