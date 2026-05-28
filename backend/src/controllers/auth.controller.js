// backend/src/controllers/auth.controller.js
const crypto = require('crypto')
const { Op } = require('sequelize')
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { compare, hash } = require('../utils/hash')
const { generateTokens, verifyRefreshToken, generateAccessToken } = require('../utils/jwt')
const { config } = require('../config')
const { logger, logSecurityEvent } = require('../utils/logger')
const { sendMail } = require('../utils/mailer')
const googleAuthService = require('../services/googleAuthService')

const Usuario = getModel('Usuario')

// ──────────────────────────────────────────────────────────────
// Constantes de lockout
// ──────────────────────────────────────────────────────────────
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 30

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
  res.cookie('__access_token', accessToken, { ...COOKIE_OPTS, maxAge: 20 * 60 * 1000 })
  res.cookie('__refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 })
}

function clearAuthCookies(res) {
  res.clearCookie('__access_token', { ...COOKIE_OPTS })
  res.clearCookie('__refresh_token', { ...COOKIE_OPTS })
}

function getFrontendUrl(req) {
  const referer = req.headers.referer || req.headers.origin || ''
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(s => s.trim())
  for (const origin of allowedOrigins) {
    if (referer.startsWith(origin)) return origin
  }
  const host = req.headers.host
  if (host && !host.includes('localhost')) {
    return `http://${host.split(':')[0]}:5173`
  }
  return allowedOrigins[0]
}

function buildRedirectPage(url) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url}"><title>Redirigiendo...</title></head><body><p>Redirigiendo...</p><script>window.location.href="${url}";</script></body></html>`
}

// Password validators reutilizables
const passwordValidators = [
  body('newPassword')
    .isString()
    .isLength({ min: 12 }).withMessage('Contraseña mínimo 12 caracteres')
    .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula')
    .matches(/[a-z]/).withMessage('Debe contener al menos una minúscula')
    .matches(/[0-9]/).withMessage('Debe contener al menos un número'),
]

// ──────────────────────────────────────────────────────────────
// LOGIN (con account lockout)
// ──────────────────────────────────────────────────────────────

const loginValidators = [
  body('correo').isEmail().withMessage('Correo inválido'),
  body('password').isString().isLength({ min: 12 }).withMessage('Contraseña mínimo 12 caracteres'),
]

async function login(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

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
      logSecurityEvent('failed_login', { reason: 'user_not_found', correo, ip: req.ip, ua: req.headers['user-agent'] })
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    // Verificar lockout
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remaining = Math.ceil((new Date(user.lockedUntil) - new Date()) / 1000)
      logSecurityEvent('login_blocked_locked', { correo, ip: req.ip, remainingSeconds: remaining })
      return res.status(423).json({
        error: 'Cuenta bloqueada temporalmente por múltiples intentos fallidos.',
        lockedUntil: user.lockedUntil,
        retryAfterSeconds: remaining,
      })
    }

    if (user.estado === false) {
      logSecurityEvent('login_blocked_disabled', { correo, ip: req.ip })
      return res.status(403).json({ error: 'Usuario deshabilitado' })
    }

    const passwordOk = await compare(password, user.password)
    if (!passwordOk) {
      // Incrementar intentos fallidos
      const attempts = (user.failedAttempts || 0) + 1
      const updateData = { failedAttempts: attempts }

      if (attempts >= MAX_FAILED_ATTEMPTS) {
        updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        logSecurityEvent('account_locked', { correo, ip: req.ip, attempts, lockMinutes: LOCKOUT_MINUTES })
      } else {
        logSecurityEvent('failed_login', { reason: 'wrong_password', correo, ip: req.ip, attempts, ua: req.headers['user-agent'] })
      }

      await user.update(updateData)
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    // Login exitoso: resetear lockout
    await user.update({ failedAttempts: 0, lockedUntil: null, last_login: new Date() })

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds }

    const { accessToken, refreshToken } = generateTokens(payload)
    setAuthCookies(res, accessToken, refreshToken)

    logger.info(`[auth] Login exitoso: ${correo}`)

    res.json({
      user: { id: user.id, username: user.username, correo: user.correo, estado: user.estado, roles }
    })
  } catch (error) {
    logger.error('[auth] Error en login:', error)
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
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { username, correo, password } = req.body

  try {
    const exists = await Usuario.findOne({ where: { correo } })
    if (exists) return res.status(409).json({ error: 'El correo ya está registrado' })

    const passwordHashed = await hash(password)
    const user = await Usuario.create({
      username: username.trim(),
      correo: correo.trim().toLowerCase(),
      password: passwordHashed,
      estado: true
    })

    const Rol = getModel('Rol')
    const trabajadorRole = await Rol.findOne({ where: { nombre: 'TRABAJADOR' } })
    if (trabajadorRole) await user.addRole(trabajadorRole)

    logger.info(`[auth] Registro exitoso: ${correo}`)
    res.status(201).json({ id: user.id, username: user.username, correo: user.correo, message: 'Usuario creado exitosamente.' })
  } catch (error) {
    logger.error('[auth] Error en register:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// REFRESH TOKEN
// ──────────────────────────────────────────────────────────────

async function refresh(req, res) {
  const refreshTokenValue = req.cookies?.__refresh_token
  if (!refreshTokenValue) return res.status(401).json({ error: 'Refresh token no proporcionado' })

  const { valid, decoded } = verifyRefreshToken(refreshTokenValue)
  if (!valid) { clearAuthCookies(res); return res.status(401).json({ error: 'Refresh token inválido o expirado' }) }

  try {
    const user = await Usuario.findOne({
      where: { id: decoded.id },
      include: [{ association: 'roles' }, { association: 'unidadNegocios', attributes: ['id', 'nombre'] }]
    })
    if (!user || user.estado === false) { clearAuthCookies(res); return res.status(401).json({ error: 'Usuario no válido' }) }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds }
    const accessToken = generateAccessToken(payload)

    res.cookie('__access_token', accessToken, { ...COOKIE_OPTS, maxAge: 20 * 60 * 1000 })
    res.json({ ok: true })
  } catch (error) {
    logger.error('[auth] Error en refresh:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// LOGOUT
// ──────────────────────────────────────────────────────────────

function logout(_req, res) {
  clearAuthCookies(res)
  res.json({ ok: true })
}

// ──────────────────────────────────────────────────────────────
// ME
// ──────────────────────────────────────────────────────────────

async function me(req, res) {
  try {
    const user = await Usuario.findOne({
      where: { id: req.auth.id },
      include: [{ association: 'roles' }, { association: 'unidadNegocios', attributes: ['id', 'nombre'] }],
      attributes: { exclude: ['password', 'resetToken', 'resetTokenExpires'] }
    })
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocios = (user.unidadNegocios || []).map(u => ({ id: u.id, nombre: u.nombre }))

    res.json({ id: user.id, username: user.username, correo: user.correo, estado: user.estado, roles, unidadNegocios, last_login: user.last_login })
  } catch (error) {
    logger.error('[auth] Error en me:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// UPDATE ME (usuario edita sus propios datos: nombre y correo)
// ──────────────────────────────────────────────────────────────

const updateMeValidators = [
  body('username').optional().isString().trim().notEmpty().withMessage('El nombre no puede estar vacío').isLength({ max: 100 }),
  body('correo').optional().isEmail().normalizeEmail().withMessage('Correo inválido'),
]

async function updateMe(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  try {
    const user = await Usuario.findByPk(req.auth.id)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    const updates = {}
    if (req.body.username !== undefined) updates.username = String(req.body.username).trim()
    if (req.body.correo !== undefined) {
      const nuevoCorreo = String(req.body.correo).trim().toLowerCase()
      if (nuevoCorreo !== user.correo) {
        const dup = await Usuario.findOne({ where: { correo: nuevoCorreo } })
        if (dup) return res.status(409).json({ error: 'Ese correo ya está en uso' })
      }
      updates.correo = nuevoCorreo
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No hay cambios para guardar' })
    }

    await user.update(updates)
    return res.json({ ok: true, id: user.id, username: user.username, correo: user.correo })
  } catch (error) {
    logger.error('[auth] Error en updateMe:', error)
    return res.status(500).json({ error: 'No se pudo actualizar el perfil' })
  }
}

// ──────────────────────────────────────────────────────────────
// CHANGE PASSWORD (autenticado)
// ──────────────────────────────────────────────────────────────

const changePasswordValidators = [
  body('currentPassword').isString().notEmpty().withMessage('Contraseña actual requerida'),
  ...passwordValidators,
]

async function changePassword(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { currentPassword, newPassword } = req.body

  try {
    const user = await Usuario.findByPk(req.auth.id)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    if (!user.password) return res.status(400).json({ error: 'Cuenta OAuth — usa la configuración de Google para cambiar tu contraseña' })

    const ok = await compare(currentPassword, user.password)
    if (!ok) {
      logSecurityEvent('password_change_failed', { userId: req.auth.id, ip: req.ip, reason: 'wrong_current_password' })
      return res.status(401).json({ error: 'Contraseña actual incorrecta' })
    }

    const hashed = await hash(newPassword)
    await user.update({ password: hashed })

    // Invalidar sesiones: limpiar cookies y forzar re-login
    clearAuthCookies(res)
    logSecurityEvent('password_changed', { userId: req.auth.id, ip: req.ip })

    res.json({ ok: true, message: 'Contraseña actualizada. Inicia sesión nuevamente.' })
  } catch (error) {
    logger.error('[auth] Error en changePassword:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// FORGOT PASSWORD (público — solicitar reset por email)
// ──────────────────────────────────────────────────────────────

const forgotPasswordValidators = [
  body('correo').isEmail().withMessage('Correo inválido'),
]

async function forgotPassword(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { correo } = req.body

  try {
    // Siempre responder igual (no revelar si el correo existe)
    const user = await Usuario.findOne({ where: { correo } })

    if (user && user.estado !== false && user.auth_provider === 'local') {
      const token = crypto.randomBytes(32).toString('hex')
      const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

      await user.update({
        resetToken: hashedToken,
        resetTokenExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hora
      })

      const frontendUrl = getFrontendUrl(req)
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`

      try {
        await sendMail({
          to: correo,
          subject: 'Restablecer contraseña — Tracker',
          html: `
            <h2>Restablecer contraseña</h2>
            <p>Haz clic en el siguiente enlace para cambiar tu contraseña:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p>Este enlace expira en 1 hora.</p>
            <p>Si no solicitaste esto, ignora este correo.</p>
          `,
        })
        logSecurityEvent('password_reset_requested', { correo, ip: req.ip })
      } catch (mailErr) {
        // No revelar al cliente que el envío falló — solo loguear
        logger.error('[auth] sendMail falló en forgotPassword:', mailErr.message)
        logSecurityEvent('password_reset_mail_failed', { correo, ip: req.ip })
      }
    }

    // Respuesta genérica siempre
    res.json({ ok: true, message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' })
  } catch (error) {
    logger.error('[auth] Error en forgotPassword:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// RESET PASSWORD (público — con token del email)
// ──────────────────────────────────────────────────────────────

const resetPasswordValidators = [
  body('token').isString().notEmpty().withMessage('Token requerido'),
  ...passwordValidators,
]

async function resetPassword(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { token, newPassword } = req.body

  try {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex')

    const user = await Usuario.findOne({
      where: {
        resetToken: hashedToken,
        resetTokenExpires: { [Op.gt]: new Date() },
      }
    })

    if (!user) {
      logSecurityEvent('password_reset_invalid_token', { ip: req.ip })
      return res.status(400).json({ error: 'Token inválido o expirado' })
    }

    const hashed = await hash(newPassword)
    await user.update({
      password: hashed,
      resetToken: null,
      resetTokenExpires: null,
      failedAttempts: 0,
      lockedUntil: null,
    })

    logSecurityEvent('password_reset_completed', { userId: user.id, ip: req.ip })

    res.json({ ok: true, message: 'Contraseña restablecida exitosamente. Ya puedes iniciar sesión.' })
  } catch (error) {
    logger.error('[auth] Error en resetPassword:', error)
    res.status(500).json({ error: 'Error interno del servidor' })
  }
}

// ──────────────────────────────────────────────────────────────
// GOOGLE OAUTH
// ──────────────────────────────────────────────────────────────

async function googleLogin(req, res) {
  try {
    const authUrl = googleAuthService.getAuthUrl()
    res.json({ authUrl })
  } catch (error) {
    logger.error('[auth] Error generando URL de Google:', error)
    res.status(500).json({ error: 'Error al iniciar autenticación con Google' })
  }
}

async function googleCallback(req, res) {
  const { code } = req.query
  if (!code) return res.status(400).json({ error: 'Código de autorización no proporcionado' })

  try {
    const tokens = await googleAuthService.getTokensFromCode(code)
    const googleUser = await googleAuthService.getUserInfo(tokens.access_token)

    let user = await Usuario.findOne({
      where: { google_id: googleUser.googleId },
      include: [{ association: 'roles' }, { association: 'unidadNegocios', attributes: ['id', 'nombre'] }]
    })

    if (!user) {
      user = await Usuario.findOne({
        where: { correo: googleUser.email },
        include: [{ association: 'roles' }, { association: 'unidadNegocios', attributes: ['id', 'nombre'] }]
      })

      if (user) {
        await user.update({ google_id: googleUser.googleId, google_refresh_token: tokens.refresh_token, profile_picture: googleUser.picture, auth_provider: 'google', last_login: new Date() })
      } else {
        user = await Usuario.create({ username: googleUser.name, correo: googleUser.email, google_id: googleUser.googleId, google_refresh_token: tokens.refresh_token, profile_picture: googleUser.picture, auth_provider: 'google', estado: true, last_login: new Date() })
        // Rol por dominio: @ecora.cl → TRABAJADOR (interno); cualquier otro → EXTERNO
        const dominio = String(googleUser.email || '').split('@')[1]?.toLowerCase() || ''
        const esInterno = dominio === config.auth.internalEmailDomain
        const rolNombre = esInterno ? 'TRABAJADOR' : 'EXTERNO'
        const Rol = getModel('Rol')
        const rol = await Rol.findOne({ where: { nombre: rolNombre } })
        if (rol) await user.addRole(rol)
        logger.info(`[auth] Usuario Google creado: ${googleUser.email} → rol ${rolNombre}`)
        await user.reload({ include: [{ association: 'roles' }, { association: 'unidadNegocios', attributes: ['id', 'nombre'] }] })
      }
    } else {
      await user.update({ google_refresh_token: tokens.refresh_token, profile_picture: googleUser.picture, last_login: new Date() })
    }

    if (user.estado === false) return res.status(403).json({ error: 'Usuario deshabilitado' })

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const { accessToken, refreshToken } = generateTokens({ id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds })
    setAuthCookies(res, accessToken, refreshToken)

    logger.info(`[auth] Login con Google exitoso: ${user.correo}`)
    const frontendUrl = getFrontendUrl(req)
    res.send(buildRedirectPage(`${frontendUrl}/auth/google/callback`))
  } catch (error) {
    logger.error('[auth] Error en callback de Google:', error)
    const frontendUrl = getFrontendUrl(req)
    res.send(buildRedirectPage(`${frontendUrl}/login?error=google_auth_failed`))
  }
}

module.exports = {
  login, loginValidators,
  register, registerValidators,
  refresh, me, logout,
  changePassword, changePasswordValidators,
  forgotPassword, forgotPasswordValidators,
  resetPassword, resetPasswordValidators,
  googleLogin, googleCallback,
  updateMe, updateMeValidators,
}
