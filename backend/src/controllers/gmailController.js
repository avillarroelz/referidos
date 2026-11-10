// backend/src/controllers/gmailController.js
// Token centralizado de la casilla de sincronización: Secrets Manager en
// producción, archivo local en desarrollo (ver services/gmailTokenStore.js)
const tokenStore = require('../services/gmailTokenStore')
const { emitirState, verificarState, limpiarState } = require('../lib/oauthState')
const { detalleParaCliente } = require('../lib/detalleError')
const { getModel } = require('../db')

// Roles que pueden conectar la casilla de sincronizacion de la empresa.
const ROLES_QUE_CONECTAN = ['ADMIN', 'RRHH', 'JefeRRHH']

// La casilla de sincronizacion es UNA y fija. Cualquier otra cuenta de Google se
// rechaza en el callback: es lo que permite que los tres roles puedan
// (re)conectarla sin que nadie pueda repuntar la sincronizacion a otro buzon.
const CASILLA_POR_DEFECTO = 'reclutamiento@ecora.cl'
const casillaDeSincronizacion = () =>
  (process.env.GMAIL_SYNC_EMAIL?.trim() || CASILLA_POR_DEFECTO).toLowerCase()

// Exportar para usar en otros controladores (async)
module.exports.getSyncRefreshToken = tokenStore.getSyncRefreshToken

/**
 * Generar URL de autorización OAuth2 para Gmail
 * Incluye el userId en el state para poder asociar el token
 */
exports.getAuthUrl = async (req, res) => {
  try {
    const client_id = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    const redirect_uri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/api/gmail/oauth2callback'

    if (!client_id) {
      return res.status(500).json({
        error: 'Gmail API no configurada. Falta GMAIL_CLIENT_ID en .env'
      })
    }

    // Scopes necesarios para sincronización de Gmail
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.labels'
    ]

    // State FIRMADO y atado a este navegador por cookie (src/lib/oauthState).
    // Antes era un base64 plano: cualquiera podia fabricarlo, y el callback lo
    // aceptaba sin verificar nada.
    const state = emitirState(res, { userId: req.auth.id })

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.searchParams.set('client_id', client_id)
    url.searchParams.set('redirect_uri', redirect_uri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', scopes.join(' '))
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    // Preselecciona la casilla en Google; el control real esta en el callback.
    url.searchParams.set('login_hint', casillaDeSincronizacion())
    // searchParams y no concatenacion: pegar el state a mano depende de que la
    // URL ya traiga query string y se pierde en silencio si algun dia no la trae.
    url.searchParams.set('state', state)
    const authUrl = url.toString()

    res.json({
      authUrl,
      instructions: 'Autoriza el acceso a Gmail para sincronizar referidos'
    })

  } catch (error) {
    res.status(500).json({
      error: 'Error generando URL de autorización',
      details: detalleParaCliente(error)
    })
  }
}

/**
 * Callback de OAuth2 de Gmail
 * Guarda el refresh_token en la configuracion centralizada
 */
exports.gmailOAuthCallback = async (req, res) => {
  const { code, state, error: oauthError } = req.query
  const frontendUrl = process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173'

  // Manejar errores de OAuth
  if (oauthError) {
    console.error('[gmail] OAuth error:', oauthError)
    return res.redirect(`${frontendUrl}/referidos?gmail_error=${oauthError}`)
  }

  // ── Validacion del state, ANTES de canjear el codigo ──
  // Va primero a proposito: canjear antes de validar permite que un tercero
  // provoque llamadas a Google con nuestras credenciales. Y sale con return: la
  // version anterior decodificaba dentro de un try cuyo catch solo escribia en
  // consola, asi que un state fabricado, ausente o corrupto continuaba el flujo
  // y terminaba sobrescribiendo el refresh_token de sincronizacion de toda la
  // empresa.
  //
  // NOTA para quien reciba esto como reporte de error: si alguien inicia la
  // conexion en un navegador y completa el consentimiento en OTRO, el flujo
  // falla aqui. Es intencional, no un defecto. La cookie que acompaña al state
  // es lo unico que permite afirmar que esta vuelta la pidio este navegador; sin
  // ella la firma sola no protege, porque el atacante puede iniciar su propio
  // flujo y obtener un state legitimamente firmado.
  const contenidoState = verificarState(req, state)
  if (!contenidoState) {
    limpiarState(res)
    console.warn('[gmail] state invalido o ausente en el callback')
    return res.redirect(`${frontendUrl}/referidos?gmail_error=invalid_state`)
  }
  limpiarState(res)

  // El comentario que estaba aqui decia que se verificaba que fuera un admin, y
  // no se verificaba nada. Ahora si: el usuario tiene que existir en la base y
  // tener uno de los roles que pueden conectar la casilla. Se comprueba contra
  // la base y no contra el payload porque el payload solo dice a quien se emitio
  // el state, no si esa persona sigue teniendo el permiso.
  const Usuario = getModel('Usuario')
  const Rol = getModel('Rol')
  const solicitante = await Usuario.findByPk(contenidoState.userId, {
    include: [{ model: Rol, as: 'roles' }],
  })
  const rolesSolicitante = (solicitante?.roles || []).map(r => r.nombre)
  if (!solicitante || solicitante.estado === false || !rolesSolicitante.some(r => ROLES_QUE_CONECTAN.includes(r))) {
    console.warn('[gmail] callback rechazado: el solicitante no puede conectar la casilla')
    return res.redirect(`${frontendUrl}/referidos?gmail_error=forbidden`)
  }

  const adminId = solicitante.id

  if (!code) {
    return res.redirect(`${frontendUrl}/referidos?gmail_error=no_code`)
  }

  try {
    // Intercambiar código por tokens
    const { google } = require('googleapis')
    const oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/api/gmail/oauth2callback'
    )

    const { tokens } = await oauth2Client.getToken(code)

    if (!tokens.refresh_token) {
      console.error('[gmail] No se recibio refresh_token')
      return res.redirect(`${frontendUrl}/referidos?gmail_error=no_refresh_token`)
    }

    // Obtener email de la cuenta autorizada usando Gmail API (no requiere scope extra)
    oauth2Client.setCredentials(tokens)
    const gmail = google.gmail({ auth: oauth2Client, version: 'v1' })
    const { data: profile } = await gmail.users.getProfile({ userId: 'me' })

    if ((profile.emailAddress || '').trim().toLowerCase() !== casillaDeSincronizacion()) {
      console.warn(`[gmail] callback rechazado: se autorizo una cuenta distinta de la casilla de sincronizacion (usuario ${adminId})`)
      // El consentimiento ya quedo otorgado en Google sobre el buzon de esa persona.
      // Se revoca para no dejar una autorizacion viva que nadie va a usar; si falla,
      // el rechazo sigue igual (el token no se guarda en ninguna parte).
      // Excepcion: si la cuenta rechazada es la que hoy esta conectada (GMAIL_SYNC_EMAIL
      // mal configurada), revocar mataria el token vigente de la sincronizacion.
      try {
        const conectada = ((await tokenStore.readConfig()).email || '').trim().toLowerCase()
        if (conectada !== profile.emailAddress.trim().toLowerCase()) {
          await oauth2Client.revokeToken(tokens.refresh_token)
        }
      } catch (e) {
        console.warn('[gmail] no se pudo revocar el permiso de la cuenta rechazada:', e.message)
      }
      return res.redirect(`${frontendUrl}/referidos?gmail_error=wrong_account`)
    }

    // Guardar en archivo de configuracion (centralizado)
    const config = {
      refresh_token: tokens.refresh_token,
      email: profile.emailAddress,
      configured_by: adminId,
      configured_at: new Date().toISOString()
    }

    try {
      await tokenStore.saveConfig(config)
      console.log(`[gmail] Token centralizado guardado (${tokenStore.storage}) para ${profile.emailAddress} por admin ${adminId}`)
      res.redirect(`${frontendUrl}/referidos?gmail_connected=true&email=${encodeURIComponent(profile.emailAddress)}`)
    } catch (e) {
      console.error('[gmail] Error guardando token:', e.name || e.message)
      res.redirect(`${frontendUrl}/referidos?gmail_error=save_failed`)
    }

  } catch (error) {
    console.error('[gmail] Error en callback:', error.message)
    console.error('[gmail] Error detalle:', error.response?.data || error.stack)
    const detail = encodeURIComponent(error.message || 'unknown')
    res.redirect(`${frontendUrl}/referidos?gmail_error=callback_failed&detail=${detail}`)
  }
}

/**
 * Obtener estado de configuracion de Gmail
 */
exports.getGmailStatus = async (req, res) => {
  try {
    const config = await tokenStore.readConfig()
    const hasEnvToken = !!process.env.GMAIL_SYNC_REFRESH_TOKEN
    const hasConfigToken = !!config.refresh_token

    res.json({
      configured: hasConfigToken || hasEnvToken,
      email: config.email || casillaDeSincronizacion(),
      configuredAt: config.configured_at || null,
      source: hasConfigToken ? tokenStore.storage : (hasEnvToken ? 'env' : null)
    })
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo estado de Gmail' })
  }
}
