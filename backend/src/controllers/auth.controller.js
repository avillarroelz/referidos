// backend/src/controllers/auth.controller.js
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { Op } = require('sequelize')
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { compare, hash } = require('../utils/hash')
const { generateTokens, verifyRefreshToken, generateAccessToken } = require('../utils/jwt')
const { config } = require('../config')
const { logger, logSecurityEvent } = require('../utils/logger')
const { emitirState, verificarState, limpiarState } = require('../lib/oauthState')
const { sendMail } = require('../utils/mailer')
const googleAuthService = require('../services/googleAuthService')

const Usuario = getModel('Usuario')

// ──────────────────────────────────────────────────────────────
// Constantes de lockout
// ──────────────────────────────────────────────────────────────
// Hash de descarte para comparar cuando el correo no existe. Se genera una vez
// al cargar el modulo, con el mismo coste que los reales, para que un intento
// contra una cuenta inexistente tarde lo mismo que contra una existente.
const HASH_SEÑUELO = bcrypt.hashSync('cuenta-inexistente-hash-de-descarte', 12)

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
  // Solo en desarrollo: acceso por IP de LAN, el front corre en el 5173 del mismo host
  const host = req.headers.host
  if (!config.isProd && host && !host.includes('localhost')) {
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

    // ── El estado de la cuenta se resuelve DESPUES de comprobar la contraseña ──
    //
    // Antes se resolvia antes, y eso convertia al login en un oraculo: el 423 de
    // cuenta bloqueada y el 403 de deshabilitada confirmaban que la cuenta
    // EXISTE a quien no tenia ninguna credencial. Peor todavia, como el bloqueo
    // salta a los cinco intentos, se podia bloquear una cuenta a proposito para
    // usar el 423 como confirmacion, que ademas deja a esa persona sin servicio.
    //
    // Ahora, sin la contraseña correcta todas las respuestas son el mismo 401.
    // El estado se informa unicamente a quien ya demostro ser el dueño.
    //
    // NO ES UN DEBILITAMIENTO DEL LOCKOUT, aunque a primera vista lo parezca:
    // una cuenta bloqueada ya no corta antes de comparar, asi que si se pueden
    // seguir probando contraseñas contra ella, pero aunque el atacante ACIERTE
    // no obtiene sesion, porque el camino de cuenta bloqueada responde 423 sin
    // emitir tokens. El lockout impide el acceso, no el intento, y eso sigue
    // intacto. Si alguien "arregla" esto devolviendo el corte temprano, reabre
    // el oraculo.
    //
    // El coste es ejecutar bcrypt tambien para correos inexistentes y cuentas
    // bloqueadas. Queda acotado por los dos limitadores del login, por correo y
    // por IP, asi que el techo de comparaciones que puede forzar un atacante no
    // cambia respecto de antes.

    // Se compara SIEMPRE, incluso sin usuario, contra un hash señuelo: si no, la
    // diferencia de tiempo entre "existe" y "no existe" delata lo mismo que ya
    // no delatan los codigos de respuesta.
    const hashAComparar = user?.password || HASH_SEÑUELO
    const passwordOk = await compare(password, hashAComparar)

    if (!user || !user.password || !passwordOk) {
      // Un motivo distinto por caso para el registro interno; la respuesta al
      // cliente es siempre la misma.
      let reason = 'wrong_password'
      if (!user) reason = 'user_not_found'
      else if (!user.password) reason = 'oauth_account'

      if (user && user.password) {
        // Solo cuentan los intentos contra una cuenta con contraseña local.
        const attempts = (user.failedAttempts || 0) + 1
        const updateData = { failedAttempts: attempts }
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          updateData.lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
          logSecurityEvent('account_locked', { correo, ip: req.ip, attempts, lockMinutes: LOCKOUT_MINUTES })
        } else {
          logSecurityEvent('failed_login', { reason, correo, ip: req.ip, attempts, ua: req.headers['user-agent'] })
        }
        await user.update(updateData)
      } else {
        logSecurityEvent('failed_login', { reason, correo, ip: req.ip, ua: req.headers['user-agent'] })
      }

      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    // Desde aqui la contraseña es correcta: quien pregunta es el dueño de la
    // cuenta, asi que informarle su estado no revela nada a un tercero.
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

    // Login exitoso: resetear lockout
    await user.update({ failedAttempts: 0, lockedUntil: null, last_login: new Date() })

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds, tokenVersion: user.tokenVersion }

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

    // Asignar rol por dominio del correo (mismo criterio que login con Google):
    // @ecora.cl -> TRABAJADOR, cualquier otro dominio -> EXTERNO.
    const dominio = String(correo).split('@')[1]?.toLowerCase() || ''
    const esInterno = dominio === config.auth.internalEmailDomain
    const rolNombre = esInterno ? 'TRABAJADOR' : 'EXTERNO'

    const Rol = getModel('Rol')
    const rol = await Rol.findOne({ where: { nombre: rolNombre } })
    if (rol) await user.addRole(rol)

    logger.info(`[auth] Registro exitoso: ${correo} -> rol ${rolNombre}`)
    res.status(201).json({ id: user.id, username: user.username, correo: user.correo, rol: rolNombre, message: 'Usuario creado exitosamente.' })
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

    // ── Revocacion de sesion ──
    // La comprobacion vive AQUI y no en authRequired a proposito: authRequired
    // no consulta la base, y hacerlo ahi agregaria una consulta a TODA la API
    // por cada peticion autenticada. refresh ya carga al usuario, asi que aca
    // comparar dos enteros no cuesta nada.
    // La contrapartida aceptada es la ventana: un access token ya emitido sigue
    // sirviendo hasta que vence, como maximo 20 minutos. Es la misma ventana que
    // ya se acepta para deshabilitar a un usuario.
    // Los tokens anteriores a esta funcionalidad no llevan el campo: se tratan
    // como version 0, que es el valor por defecto de la columna.
    const versionDelToken = decoded.tokenVersion ?? 0
    if (versionDelToken !== user.tokenVersion) {
      clearAuthCookies(res)
      logSecurityEvent('refresh_revocado', { userId: user.id, ip: req.ip })
      return res.status(401).json({ error: 'Sesión revocada. Inicia sesión nuevamente.' })
    }

    const roles = (user.roles || []).map(r => r.nombre)
    const unidadNegocioIds = (user.unidadNegocios || []).map(u => u.id)
    const payload = { id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds, tokenVersion: user.tokenVersion }
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
    // Incrementar tokenVersion invalida TODAS las sesiones del usuario, en este
    // y en cualquier otro dispositivo. Es lo correcto aca: si alguien cambia su
    // contraseña porque sospecha que le robaron la sesion, el intruso tiene que
    // quedar fuera, no solo el navegador que hizo el cambio.
    await user.update({ password: hashed, tokenVersion: user.tokenVersion + 1 })

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
          subject: 'Restablecer contraseña — Referidos',
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
      // Mismo motivo que en changePassword: quien recupera su cuenta expulsa a
      // quien la tuviera abierta.
      tokenVersion: user.tokenVersion + 1,
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
    // El state ata esta vuelta al navegador que la pidio. Sin el, el callback no
    // puede distinguir un regreso legitimo de uno provocado por un tercero, que
    // es como se fuerza a alguien a quedar con la sesion del atacante abierta.
    const state = emitirState(res)
    // Con URL y no concatenando: agregar "&state=" a mano depende de que la URL
    // ya traiga query string, y si algun dia no la trae el parametro se pierde
    // en silencio y el callback rechaza todos los inicios.
    const url = new URL(googleAuthService.getAuthUrl())
    url.searchParams.set('state', state)
    res.json({ authUrl: url.toString() })
  } catch (error) {
    logger.error('[auth] Error generando URL de Google:', error)
    res.status(500).json({ error: 'Error al iniciar autenticación con Google' })
  }
}

async function googleCallback(req, res) {
  const { code, state } = req.query

  // Se verifica ANTES de canjear el codigo y con return: un state invalido
  // detiene el flujo aqui, no sigue y "ya veremos". Es justo el error del
  // callback de Gmail, donde el catch no corta y el flujo continua igual.
  if (!verificarState(req, state)) {
    limpiarState(res)
    logSecurityEvent('google_state_invalido', { ip: req.ip })
    return res.send(buildRedirectPage(`${getFrontendUrl(req)}/login?error=google_auth_failed`))
  }
  limpiarState(res)

  if (!code) return res.status(400).json({ error: 'Código de autorización no proporcionado' })

  try {
    const tokens = await googleAuthService.getTokensFromCode(code)
    const googleUser = await googleAuthService.getUserInfo(tokens.access_token)

    // Sin correo verificado no se vincula ni se crea nada: la identidad de una
    // cuenta local se decide por su correo, asi que aceptar uno no verificado
    // permitiria quedarse con la cuenta de otra persona. El mensaje al usuario
    // es el generico, para no informar de que depende el rechazo.
    if (googleUser.verifiedEmail !== true) {
      logSecurityEvent('google_correo_no_verificado', { correo: googleUser.email, ip: req.ip })
      return res.send(buildRedirectPage(`${getFrontendUrl(req)}/login?error=google_auth_failed`))
    }

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
    // tokenVersion tiene que ir tambien aca: sin el, quien entra con Google y ya
    // cambio su clave alguna vez lleva version 0 en el token, no coincide con la
    // suya y queda desconectado en cada renovacion.
    const { accessToken, refreshToken } = generateTokens({ id: user.id, correo: user.correo, username: user.username, roles, unidadNegocioIds, tokenVersion: user.tokenVersion })
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
