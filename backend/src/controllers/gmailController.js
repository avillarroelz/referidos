// backend/src/controllers/gmailController.js
const gmailService = require('../services/gmailService')
// Token centralizado de la casilla de sincronización: Secrets Manager en
// producción, archivo local en desarrollo (ver services/gmailTokenStore.js)
const tokenStore = require('../services/gmailTokenStore')
const { emitirState, verificarState, limpiarState } = require('../lib/oauthState')
const { getModel } = require('../db')

// Roles que pueden conectar la casilla de sincronizacion de la empresa.
const ROLES_QUE_CONECTAN = ['ADMIN', 'RRHH']

// Exportar para usar en otros controladores (async)
module.exports.getSyncRefreshToken = tokenStore.getSyncRefreshToken

/**
 * Procesar correos de Gmail y crear referidos
 */
exports.processGmailReferidos = async (req, res) => {
  try {
    const userId = req.auth.id
    const {
      query = 'subject:referido is:unread',
      maxResults = 50,
      autoMarkRead = true,
      addLabel = true,
      credentials
    } = req.body

    // Validar que el usuario tenga permisos (ADMIN o RRHH)
    if (!req.auth.roles?.includes('ADMIN') && !req.auth.roles?.includes('RRHH')) {
      return res.status(403).json({
        error: 'No tienes permisos para procesar correos'
      })
    }

    // Validar credenciales
    if (!credentials || !credentials.refresh_token) {
      return res.status(400).json({
        error: 'Debes proporcionar las credenciales de Gmail (refresh_token)'
      })
    }

    // Inicializar servicio
    await gmailService.initialize({
      client_id: process.env.GMAIL_CLIENT_ID || credentials.client_id,
      client_secret: process.env.GMAIL_CLIENT_SECRET || credentials.client_secret,
      redirect_uri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/api/gmail/oauth2callback',
      refresh_token: credentials.refresh_token
    })

    // Procesar correos
    const results = await gmailService.processEmails(userId, {
      query,
      maxResults,
      autoMarkRead,
      addLabel
    })

    res.json({
      success: true,
      message: `Se procesaron ${results.processed} correos, se crearon ${results.created} referidos`,
      ...results
    })

  } catch (error) {
    console.error('Error en processGmailReferidos:', error)
    res.status(500).json({
      error: 'Error procesando correos de Gmail',
      details: error.message
    })
  }
}

/**
 * Vista previa de correos sin procesarlos
 */
exports.previewGmailReferidos = async (req, res) => {
  try {
    const {
      query = 'subject:referido is:unread',
      maxResults = 10,
      credentials
    } = req.body

    // Validar que el usuario tenga permisos
    if (!req.auth.roles?.includes('ADMIN') && !req.auth.roles?.includes('RRHH')) {
      return res.status(403).json({
        error: 'No tienes permisos para ver correos'
      })
    }

    // Validar credenciales
    if (!credentials || !credentials.refresh_token) {
      return res.status(400).json({
        error: 'Debes proporcionar las credenciales de Gmail'
      })
    }

    // Inicializar servicio
    await gmailService.initialize({
      client_id: process.env.GMAIL_CLIENT_ID || credentials.client_id,
      client_secret: process.env.GMAIL_CLIENT_SECRET || credentials.client_secret,
      redirect_uri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:4000/api/gmail/oauth2callback',
      refresh_token: credentials.refresh_token
    })

    // Buscar correos
    const messages = await gmailService.searchEmails(query, maxResults)

    if (!messages || messages.length === 0) {
      return res.json({
        count: 0,
        emails: [],
        message: 'No se encontraron correos'
      })
    }

    // Obtener detalles y extraer datos
    const emailsWithData = []
    for (const message of messages.slice(0, maxResults)) {
      const email = await gmailService.getEmail(message.id)
      const parsedData = gmailService.parseEmailContent(email)

      emailsWithData.push({
        id: message.id,
        subject: parsedData.subject,
        from: parsedData.from,
        date: parsedData.date,
        extractedData: parsedData.extractedData
      })
    }

    res.json({
      count: emailsWithData.length,
      emails: emailsWithData
    })

  } catch (error) {
    console.error('Error en previewGmailReferidos:', error)
    res.status(500).json({
      error: 'Error obteniendo vista previa de correos',
      details: error.message
    })
  }
}

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
      details: error.message
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
      email: config.email || process.env.GMAIL_SYNC_EMAIL || null,
      configuredAt: config.configured_at || null,
      source: hasConfigToken ? tokenStore.storage : (hasEnvToken ? 'env' : null)
    })
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo estado de Gmail' })
  }
}
