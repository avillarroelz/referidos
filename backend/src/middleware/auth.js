// backend/src/middleware/auth.js
const { verifyAccessToken } = require('../utils/jwt')
const { getModel } = require('../db')

/**
 * Middleware que requiere autenticación JWT
 */
function authRequired(req, res, next) {
  // Prioridad: 1) Cookie httpOnly, 2) Header Authorization, 3) Query string (descargas)
  let token = null

  if (req.cookies?.__access_token) {
    token = req.cookies.__access_token
  } else {
    const authHeader = req.header('Authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.replace('Bearer ', '')
    } else if (req.query.token) {
      token = req.query.token
    }
  }

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

  console.log(`[auth] Usuario autenticado: id=${req.auth.id}, roles=[${req.auth.roles.join(',')}]`)
  next()
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
  const authHeader = req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.replace('Bearer ', '')
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