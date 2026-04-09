// backend/src/controllers/auth.controller.js
const crypto = require('crypto')
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { compare, hash } = require('../utils/hash')
const { generateTokens, verifyRefreshToken, generateAccessToken } = require('../utils/jwt')
const googleAuthService = require('../services/googleAuthService')

const Usuario = getModel('Usuario')

// Detectar URL del frontend basado en el referer o CORS_ORIGIN
function getFrontendUrl(req) {
  const referer = req.headers.referer || req.headers.origin || ''
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim())

  // Si el referer coincide con algún origen permitido, usarlo
  for (const origin of allowedOrigins) {
    if (referer.startsWith(origin)) return origin
  }

  // Fallback: detectar si el request viene por IP y construir URL con el mismo host
  const host = req.headers.host // e.g. "10.10.10.103:4000"
  if (host && !host.includes('localhost')) {
    const hostname = host.split(':')[0]
    return `http://${hostname}:5173`
  }

  return allowedOrigins[0]
}

// Página HTML que redirige al frontend (evita bloqueo de redirect cross-origin)
function buildRedirectPage(url) {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${url}">
<title>Redirigiendo...</title>
</head><body>
<p>Redirigiendo...</p>
<script>window.location.href="${url}";</script>
</body></html>`
}

// Store temporal para códigos OAuth (TTL 60s)
const oauthCodes = new Map()
function storeOAuthCode(tokens) {
  const code = crypto.randomBytes(32).toString('hex')
  oauthCodes.set(code, tokens)
  setTimeout(() => oauthCodes.delete(code), 60000)
  return code
}

// ──────────────────────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────────────────────

const loginValidators = [
  body('correo').isEmail().withMessage('Correo inválido'),
  body('password').isString().isLength({ min: 8 }).withMessage('Contraseña mínimo 8 caracteres'),
]

async function login(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { correo, password } = req.body

  try {
    // Buscar usuario con roles y unidades de negocio
    const user = await Usuario.findOne({
      where: { correo },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ]
    })

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    if (user.estado === false) {
      return res.status(403).json({ error: 'Usuario deshabilitado' })
    }

    // Verificar contraseña
    const passwordOk = await compare(password, user.password)
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    // Preparar payload
    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = {
      id: user.id,
      correo: user.correo,
      username: user.username,
      roles,
      unidadNegocioIds
    }

    // Generar tokens
    const { accessToken, refreshToken } = generateTokens(payload)

    // Actualizar last_login
    await user.update({ last_login: new Date() })

    console.log(`[auth] Login exitoso: ${correo}`)

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        username: user.username,
        correo: user.correo,
        estado: user.estado,
        roles
      }
    })
  } catch (error) {
    console.error('[auth] Error en login:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// REGISTER
// ──────────────────────────────────────────────────────────────

const registerValidators = [
  body('username').isString().notEmpty().withMessage('Username requerido'),
  body('correo').isEmail().withMessage('Correo inválido'),
  body('password').isString().isLength({ min: 8 }).withMessage('Contraseña mínimo 8 caracteres'),
]

async function register(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { username, correo, password } = req.body

  try {
    // Verificar si ya existe
    const exists = await Usuario.findOne({ where: { correo } })
    if (exists) {
      return res.status(409).json({ error: 'El correo ya está registrado' })
    }

    // Crear usuario
    const passwordHashed = await hash(password)
    const user = await Usuario.create({
      username: username.trim(),
      correo: correo.trim().toLowerCase(),
      password: passwordHashed,
      estado: true
    })

    // Asignar rol por defecto (TRABAJADOR)
    const Rol = getModel('Rol')
    const trabajadorRole = await Rol.findOne({ where: { nombre: 'TRABAJADOR' } })
    if (trabajadorRole) {
      await user.addRole(trabajadorRole)
    }

    console.log(`[auth] Registro exitoso: ${correo}`)

    res.status(201).json({
      id: user.id,
      username: user.username,
      correo: user.correo,
      message: 'Usuario creado exitosamente. Ahora puedes iniciar sesión.'
    })
  } catch (error) {
    console.error('[auth] Error en register:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// REFRESH TOKEN
// ──────────────────────────────────────────────────────────────

const refreshValidators = [
  body('refreshToken').isString().notEmpty().withMessage('Refresh token requerido')
]

async function refresh(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { refreshToken } = req.body
  const { valid, decoded, error } = verifyRefreshToken(refreshToken)

  if (!valid) {
    return res.status(401).json({ error: 'Refresh token inválido o expirado' })
  }

  try {
    // Verificar que el usuario aún existe y está activo
    const user = await Usuario.findOne({
      where: { id: decoded.id },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ]
    })

    if (!user || user.estado === false) {
      return res.status(401).json({ error: 'Usuario no válido' })
    }

    // Generar nuevo access token
    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = {
      id: user.id,
      correo: user.correo,
      username: user.username,
      roles,
      unidadNegocioIds
    }

    const accessToken = generateAccessToken(payload)

    console.log(`[auth] Token renovado para: ${user.correo}`)

    res.json({ accessToken })
  } catch (error) {
    console.error('[auth] Error en refresh:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// ME (obtener info del usuario actual)
// ──────────────────────────────────────────────────────────────

async function me(req, res) {
  try {
    const user = await Usuario.findOne({
      where: { id: req.auth.id },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ],
      attributes: { exclude: ['password'] }
    })

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocios = (user.unidadNegocios || []).map(u => ({ id: u.id, nombre: u.nombre }))

    res.json({
      id: user.id,
      username: user.username,
      correo: user.correo,
      estado: user.estado,
      roles,
      unidadNegocios,
      last_login: user.last_login
    })
  } catch (error) {
    console.error('[auth] Error en me:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// GOOGLE OAUTH LOGIN
// ──────────────────────────────────────────────────────────────

/**
 * Iniciar el flujo de OAuth con Google
 * Redirige al usuario a la página de autorización de Google
 */
async function googleLogin(req, res) {
  try {
    const authUrl = googleAuthService.getAuthUrl()
    res.json({ authUrl })
  } catch (error) {
    console.error('[auth] Error generando URL de Google:', error)
    res.status(500).json({ error: 'Error al iniciar autenticación con Google' })
  }
}

/**
 * Callback de Google OAuth
 * Recibe el código de autorización y crea/actualiza el usuario
 */
async function googleCallback(req, res) {
  const { code } = req.query

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización no proporcionado' })
  }

  try {
    // Obtener tokens de Google
    const tokens = await googleAuthService.getTokensFromCode(code)

    // Obtener información del usuario
    const googleUser = await googleAuthService.getUserInfo(tokens.access_token)

    // Buscar o crear usuario
    let user = await Usuario.findOne({
      where: { google_id: googleUser.googleId },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ]
    })

    if (!user) {
      // Verificar si existe un usuario con ese email (migración de cuenta local a Google)
      user = await Usuario.findOne({
        where: { correo: googleUser.email },
        include: [
          { association: 'roles' },
          { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
        ]
      })

      if (user) {
        // Usuario existe pero no tiene Google ID, actualizar
        await user.update({
          google_id: googleUser.googleId,
          google_refresh_token: tokens.refresh_token,
          profile_picture: googleUser.picture,
          auth_provider: 'google',
          last_login: new Date()
        })
      } else {
        // Crear nuevo usuario
        user = await Usuario.create({
          username: googleUser.name,
          correo: googleUser.email,
          google_id: googleUser.googleId,
          google_refresh_token: tokens.refresh_token,
          profile_picture: googleUser.picture,
          auth_provider: 'google',
          estado: true,
          last_login: new Date()
        })

        // Asignar rol por defecto (TRABAJADOR)
        const Rol = getModel('Rol')
        const trabajadorRole = await Rol.findOne({ where: { nombre: 'TRABAJADOR' } })
        if (trabajadorRole) {
          await user.addRole(trabajadorRole)
        }

        // Recargar usuario con roles y unidades
        await user.reload({
          include: [
            { association: 'roles' },
            { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
          ]
        })
      }
    } else {
      // Usuario ya existe, actualizar tokens y última conexión
      await user.update({
        google_refresh_token: tokens.refresh_token,
        profile_picture: googleUser.picture,
        last_login: new Date()
      })
    }

    // Verificar estado del usuario
    if (user.estado === false) {
      return res.status(403).json({ error: 'Usuario deshabilitado' })
    }

    // Preparar payload y generar tokens JWT
    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = {
      id: user.id,
      correo: user.correo,
      username: user.username,
      roles,
      unidadNegocioIds
    }

    const { accessToken, refreshToken } = generateTokens(payload)

    console.log(`[auth] Login con Google exitoso: ${user.correo}`)

    // Guardar tokens con código temporal y redirigir con página HTML
    const tempCode = storeOAuthCode({ accessToken, refreshToken })
    const frontendUrl = getFrontendUrl(req)
    const redirectUrl = `${frontendUrl}/auth/google/callback?code=${tempCode}`
    res.send(buildRedirectPage(redirectUrl))
  } catch (error) {
    console.error('[auth] Error en callback de Google:', error)
    const frontendUrl = getFrontendUrl(req)
    res.send(buildRedirectPage(`${frontendUrl}/login?error=google_auth_failed`))
  }
}

/**
 * Intercambiar código temporal por tokens JWT
 */
async function googleExchange(req, res) {
  const { code } = req.body

  if (!code || !oauthCodes.has(code)) {
    return res.status(400).json({ error: 'Código inválido o expirado' })
  }

  const tokens = oauthCodes.get(code)
  oauthCodes.delete(code)

  res.json(tokens)
}

module.exports = {
  login,
  loginValidators,
  register,
  registerValidators,
  refresh,
  refreshValidators,
  me,
  googleLogin,
  googleCallback,
  googleExchange
}