// backend/src/middleware/auth.js
const { verifyAccessToken } = require('../utils/jwt')
const { getModel } = require('../db')

/**
 * Middleware que requiere autenticación JWT
 */
function authRequired(req, res, next) {
  // Prioridad: 1) Cookie httpOnly, 2) Header Authorization.
  // No se acepta token por query string: quedaría expuesto en logs de acceso,
  // historial del navegador y cabeceras Referer.
  const token = extractToken(req)

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' })
  }

  const { valid, decoded, error } = verifyAccessToken(token)

  if (!valid) {
    console.log('[auth] Token inválido:', error)
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }

  // Adjuntar datos del usuario al request
  req.auth = {
    id: decoded.id,
    roles: decoded.roles || [],
    correo: decoded.correo
  }

  next()
}

/**
 * Extrae el token de la cookie httpOnly o del header Authorization
 */
function extractToken(req) {
  if (req.cookies?.__access_token) return req.cookies.__access_token
  const authHeader = req.header('Authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '')
  }
  return null
}

/**
 * Middleware que requiere roles específicos
 */
function requireRoles(...requiredRoles) {
  return async (req, res, next) => {
    if (!req.auth?.id) {
      return res.status(401).json({ error: 'No autenticado' })
    }

    const userRoles = req.auth.roles || []
    const hasRole = requiredRoles.some(role => userRoles.includes(role))

    if (!hasRole) {
      console.log(`[roles] Acceso denegado. Requeridos: [${requiredRoles.join(',')}], Usuario: [${userRoles.join(',')}]`)
      return res.status(403).json({ error: 'Sin permisos suficientes' })
    }

    next()
  }
}

/**
 * Middleware opcional: adjunta user si hay token válido
 */
function authOptional(req, res, next) {
  const token = extractToken(req)
  if (!token) {
    return next()
  }

  const { valid, decoded } = verifyAccessToken(token)

  if (valid) {
    req.auth = {
      id: decoded.id,
      roles: decoded.roles || [],
      correo: decoded.correo
    }
  }

  next()
}

module.exports = { authRequired, requireRoles, authOptional }