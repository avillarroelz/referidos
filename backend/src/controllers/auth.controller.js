// backend/src/controllers/auth.controller.js
const crypto = require('crypto')
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { compare, hash } = require('../utils/hash')
const { generateTokens, verifyRefreshToken, generateAccessToken } = require('../utils/jwt')
const { config } = require('../config')
const googleAuthService = require('../services/googleAuthService')

const Usuario = getModel('Usuario')

// ──────────────────────────────────────────────────────────────
// Cookie helpers (patrón WebEcora/backendDesv)
// ──────────────────────────────────────────────────────────────

const COOKIE_OPTS = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: config.isProd ? 'strict' : 'lax',
  path: '/',
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('__access_token', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 20 * 60 * 1000, // 20 min (match JWT_EXPIRES_IN)
  })
  res.cookie('__refresh_token', refreshToken, {
    ...COOKIE_OPTS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días (match JWT_REFRESH_EXPIRES_IN)
  })
}

function clearAuthCookies(res) {
  res.clearCookie('__access_token', { ...COOKIE_OPTS })
  res.clearCookie('__refresh_token', { ...COOKIE_OPTS })
}

// Detectar URL del frontend basado en el referer o CORS_ORIGIN
function getFrontendUrl(req) {
  const referer = req.headers.referer || req.headers.origin || ''
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim())

  for (const origin of allowedOrigins) {
    if (referer.startsWith(origin)) return origin
  }

  const host = req.headers.host
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
function storeOAuthCode(data) {
  const code = crypto.randomBytes(32).toString('hex')
  oauthCodes.set(code, data)
  setTimeout(() => oauthCodes.delete(code), 60000)
  return code
}

// ──────────────────────────────────────────────────────────────
// LOGIN
// ──────────────────────────────────────────────────────────────

const loginValidators = [
  body('correo').isEmail().withMessage('Correo inválido'),
  body('password').isString().isLength({ min: 12 }).withMessage('Contraseña mínimo 12 caracteres'),
]

async function login(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { correo, password } = req.body

  try {
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

    const passwordOk = await compare(password, user.password)
    if (!passwordOk) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds }

    const { accessToken, refreshToken } = generateTokens(payload)

    await user.update({ last_login: new Date() })

    // Tokens en httpOnly cookies (no en el body)
    setAuthCookies(res, accessToken, refreshToken)

    console.log(`[auth] Login exitoso: ${correo}`)

    res.json({
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
  body('password')
    .isString()
    .isLength({ min: 12 }).withMessage('Contraseña mínimo 12 caracteres')
    .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula')
    .matches(/[a-z]/).withMessage('Debe contener al menos una minúscula')
    .matches(/[0-9]/).withMessage('Debe contener al menos un número'),
]

async function register(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { username, correo, password } = req.body

  try {
    const exists = await Usuario.findOne({ where: { correo } })
    if (exists) {
      return res.status(409).json({ error: 'El correo ya está registrado' })
    }

    const passwordHashed = await hash(password)
    const user = await Usuario.create({
      username: username.trim(),
      correo: correo.trim().toLowerCase(),
      password: passwordHashed,
      estado: true
    })

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
// REFRESH TOKEN (lee refresh de cookie, no del body)
// ──────────────────────────────────────────────────────────────

async function refresh(req, res) {
  // Leer refresh token desde cookie httpOnly
  const refreshTokenValue = req.cookies?.__refresh_token
  if (!refreshTokenValue) {
    return res.status(401).json({ error: 'Refresh token no proporcionado' })
  }

  const { valid, decoded, error } = verifyRefreshToken(refreshTokenValue)

  if (!valid) {
    clearAuthCookies(res)
    return res.status(401).json({ error: 'Refresh token inválido o expirado' })
  }

  try {
    const user = await Usuario.findOne({
      where: { id: decoded.id },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ]
    })

    if (!user || user.estado === false) {
      clearAuthCookies(res)
      return res.status(401).json({ error: 'Usuario no válido' })
    }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds }

    const accessToken = generateAccessToken(payload)

    // Actualizar cookie de access token
    res.cookie('__access_token', accessToken, {
      ...COOKIE_OPTS,
      maxAge: 20 * 60 * 1000,
    })

    console.log(`[auth] Token renovado para: ${user.correo}`)

    res.json({ ok: true })
  } catch (error) {
    console.error('[auth] Error en refresh:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// LOGOUT (limpiar cookies)
// ──────────────────────────────────────────────────────────────

function logout(_req, res) {
  clearAuthCookies(res)
  res.json({ ok: true })
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

async function googleLogin(req, res) {
  try {
    const authUrl = googleAuthService.getAuthUrl()
    res.json({ authUrl })
  } catch (error) {
    console.error('[auth] Error generando URL de Google:', error)
    res.status(500).json({ error: 'Error al iniciar autenticación con Google' })
  }
}

async function googleCallback(req, res) {
  const { code } = req.query

  if (!code) {
    return res.status(400).json({ error: 'Código de autorización no proporcionado' })
  }

  try {
    const tokens = await googleAuthService.getTokensFromCode(code)
    const googleUser = await googleAuthService.getUserInfo(tokens.access_token)

    let user = await Usuario.findOne({
      where: { google_id: googleUser.googleId },
      include: [
        { association: 'roles' },
        { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
      ]
    })

    if (!user) {
      user = await Usuario.findOne({
        where: { correo: googleUser.email },
        include: [
          { association: 'roles' },
          { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
        ]
      })

      if (user) {
        await user.update({
          google_id: googleUser.googleId,
          google_refresh_token: tokens.refresh_token,
          profile_picture: googleUser.picture,
          auth_provider: 'google',
          last_login: new Date()
        })
      } else {
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

        const Rol = getModel('Rol')
        const trabajadorRole = await Rol.findOne({ where: { nombre: 'TRABAJADOR' } })
        if (trabajadorRole) {
          await user.addRole(trabajadorRole)
        }

        await user.reload({
          include: [
            { association: 'roles' },
            { association: 'unidadNegocios', attributes: ['id', 'nombre'] }
          ]
        })
      }
    } else {
      await user.update({
        google_refresh_token: tokens.refresh_token,
        profile_picture: googleUser.picture,
        last_login: new Date()
      })
    }

    if (user.estado === false) {
      return res.status(403).json({ error: 'Usuario deshabilitado' })
    }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds }

    const { accessToken, refreshToken } = generateTokens(payload)

    // Setear cookies httpOnly directamente en el callback
    setAuthCookies(res, accessToken, refreshToken)

    console.log(`[auth] Login con Google exitoso: ${user.correo}`)

    // Redirigir al frontend (las cookies ya están seteadas)
    const frontendUrl = getFrontendUrl(req)
    res.send(buildRedirectPage(`${frontendUrl}/auth/google/callback`))
  } catch (error) {
    console.error('[auth] Error en callback de Google:', error)
    const frontendUrl = getFrontendUrl(req)
    res.send(buildRedirectPage(`${frontendUrl}/login?error=google_auth_failed`))
  }
}

module.exports = {
  login,
  loginValidators,
  register,
  registerValidators,
  refresh,
  me,
  logout,
  googleLogin,
  googleCallback,
}
