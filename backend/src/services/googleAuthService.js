// backend/src/services/googleAuthService.js
const { google } = require('googleapis')

class GoogleAuthService {
  constructor() {
    this.oauth2Client = null
  }

  /**
   * Inicializar cliente OAuth2
   */
  initialize() {
    // Usar credenciales específicas para login (GOOGLE_* en lugar de GMAIL_*)
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.GMAIL_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/api/auth/google/callback'

    if (!clientId || !clientSecret) {
      throw new Error('Credenciales de Google OAuth2 no configuradas')
    }

    this.oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    )

    return this
  }

  /**
   * Generar URL de autorización para login
   */
  getAuthUrl() {
    if (!this.oauth2Client) {
      this.initialize()
    }

    // Scopes mínimos para login (solo perfil y email)
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
    ]

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'select_account', // Permite seleccionar cuenta sin forzar consentimiento
      include_granted_scopes: false // NO incluir scopes previamente otorgados
    })
  }

  /**
   * Obtener tokens a partir del código de autorización
   */
  async getTokensFromCode(code) {
    if (!this.oauth2Client) {
      this.initialize()
    }

    try {
      const { tokens } = await this.oauth2Client.getToken(code)
      return tokens
    } catch (error) {
      console.error('Error obteniendo tokens:', error)
      throw new Error('Error al obtener tokens de Google')
    }
  }

  /**
   * Obtener información del perfil del usuario
   */
  async getUserInfo(accessToken) {
    try {
      const oauth2 = google.oauth2({
        auth: this.oauth2Client,
        version: 'v2'
      })

      this.oauth2Client.setCredentials({ access_token: accessToken })

      const { data } = await oauth2.userinfo.get()

      return {
        googleId: data.id,
        email: data.email,
        name: data.name,
        picture: data.picture,
        verifiedEmail: data.verified_email
      }
    } catch (error) {
      console.error('Error obteniendo info de usuario:', error)
      throw new Error('Error al obtener información del usuario de Google')
    }
  }

  /**
   * Verificar token de acceso
   */
  async verifyAccessToken(accessToken) {
    try {
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: accessToken,
        audience: process.env.GMAIL_CLIENT_ID
      })

      const payload = ticket.getPayload()
      return {
        valid: true,
        payload
      }
    } catch (error) {
      return {
        valid: false,
        error: error.message
      }
    }
  }
}

module.exports = new GoogleAuthService()
