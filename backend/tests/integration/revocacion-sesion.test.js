// backend/tests/integration/revocacion-sesion.test.js
// Revocacion de sesion por tokenVersion (V17).
//
// Antes de esto una sesion no se podia revocar: logout solo borraba la cookie
// del navegador y changePassword decia en un comentario "Invalidar sesiones"
// pero solo limpiaba las cookies de quien cambiaba la clave. Un refresh token
// robado seguia sirviendo siete dias, y quien cambiaba su contraseña creyendo
// que expulsaba al intruso no expulsaba a nadie.
//
// El contador vive en la tabla usuarios, viaja en el JWT y se compara en
// REFRESH. Ahi no cuesta nada porque refresh ya carga al usuario. La ventana de
// exposicion es la vida del access token, 20 minutos, que es la misma que ya se
// acepta para deshabilitar a alguien.

const crypto = require('crypto')
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser } = require('../helpers/auth')

const CLAVE = 'ClaveInicial123'
const CLAVE_NUEVA = 'ClaveCambiada456'

/** Extrae una cookie concreta de la respuesta, para controlar que token se usa. */
function cookieDe(res, nombre) {
  const cookies = res.headers['set-cookie'] || []
  const encontrada = cookies.find(c => c.startsWith(`${nombre}=`))
  return encontrada ? encontrada.split(';')[0] : null
}

describe('Revocacion de sesion por tokenVersion', () => {
  let getModel
  let seq = 0

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
  })

  /** Usuario local con sesion iniciada. Devuelve sus dos cookies. */
  async function usuarioConSesion() {
    const n = ++seq
    const correo = `sesion-${n}@ecora.cl`
    await createTestUser(getModel, {
      username: `sesion-${n}`, correo, password: CLAVE, roles: ['TRABAJADOR'],
    })

    const login = await request(app).post('/api/auth/login').send({ correo, password: CLAVE })
    expect(login.status).toBe(200)

    return {
      correo,
      access: cookieDe(login, '__access_token'),
      refresh: cookieDe(login, '__refresh_token'),
    }
  }

  const renovar = (cookieRefresh) =>
    request(app).post('/api/auth/refresh').set('Cookie', cookieRefresh)

  // ────────────────────────────────────────────────────────────────
  // Cambio de contraseña
  // ────────────────────────────────────────────────────────────────

  describe('cambio de contraseña', () => {
    it('el refresh token anterior deja de servir', async () => {
      const sesion = await usuarioConSesion()

      // Antes del cambio el token renueva sin problema.
      expect((await renovar(sesion.refresh)).status).toBe(200)

      const cambio = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', sesion.access)
        .send({ currentPassword: CLAVE, newPassword: CLAVE_NUEVA })
      expect(cambio.status).toBe(200)

      // Este es el escenario que motivo V17: el intruso que copio el refresh
      // token antes del cambio debe quedar fuera.
      const res = await renovar(sesion.refresh)
      expect(res.status).toBe(401)
    })

    it('la sesion nueva, obtenida con la clave nueva, si renueva', async () => {
      const sesion = await usuarioConSesion()

      await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', sesion.access)
        .send({ currentPassword: CLAVE, newPassword: CLAVE_NUEVA })

      const login = await request(app)
        .post('/api/auth/login')
        .send({ correo: sesion.correo, password: CLAVE_NUEVA })
      expect(login.status).toBe(200)

      const res = await renovar(cookieDe(login, '__refresh_token'))
      expect(res.status).toBe(200)
    })

    it('incrementa el contador del usuario', async () => {
      const sesion = await usuarioConSesion()
      const Usuario = getModel('Usuario')
      const antes = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion

      await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', sesion.access)
        .send({ currentPassword: CLAVE, newPassword: CLAVE_NUEVA })

      const despues = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion
      expect(despues).toBe(antes + 1)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Reset de contraseña
  // ────────────────────────────────────────────────────────────────

  describe('reset de contraseña', () => {
    /** Deja el token de reset en la BD, tal como lo dejaria forgotPassword. */
    async function prepararReset(correo) {
      const token = crypto.randomBytes(32).toString('hex')
      const hashed = crypto.createHash('sha256').update(token).digest('hex')
      await getModel('Usuario').update(
        { resetToken: hashed, resetTokenExpires: new Date(Date.now() + 3600_000) },
        { where: { correo } }
      )
      return token
    }

    it('el refresh token anterior deja de servir', async () => {
      const sesion = await usuarioConSesion()
      const token = await prepararReset(sesion.correo)

      const reset = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, newPassword: CLAVE_NUEVA })
      expect(reset.status).toBe(200)

      const res = await renovar(sesion.refresh)
      expect(res.status).toBe(401)
    })

    it('incrementa el contador del usuario', async () => {
      const sesion = await usuarioConSesion()
      const Usuario = getModel('Usuario')
      const antes = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion
      const token = await prepararReset(sesion.correo)

      await request(app).post('/api/auth/reset-password').send({ token, newPassword: CLAVE_NUEVA })

      const despues = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion
      expect(despues).toBe(antes + 1)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Que NO se rompio
  // ────────────────────────────────────────────────────────────────

  describe('camino feliz', () => {
    it('un usuario cuyo contador no cambio sigue renovando', async () => {
      const sesion = await usuarioConSesion()

      for (let i = 0; i < 3; i++) {
        expect((await renovar(sesion.refresh)).status).toBe(200)
      }
    })
  })

  describe('aislamiento entre usuarios', () => {
    // El error clasico aca es equivocarse de condicion y revocar de mas: que el
    // cambio de clave de una persona cierre las sesiones de todo el mundo.
    it('el cambio de contraseña de un usuario no afecta la sesion de otro', async () => {
      const uno = await usuarioConSesion()
      const otro = await usuarioConSesion()

      await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', uno.access)
        .send({ currentPassword: CLAVE, newPassword: CLAVE_NUEVA })

      expect((await renovar(uno.refresh)).status).toBe(401)
      expect((await renovar(otro.refresh)).status).toBe(200)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // El logout NO revoca, y es deliberado
  // ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    // tokenVersion tiene granularidad por USUARIO, asi que incrementarlo en el
    // logout cerraria la sesion del celular al cerrar la del computador. Se
    // dejo fuera a proposito; este caso lo fija para que nadie lo agregue
    // despues creyendo que falta.
    it('NO incrementa el contador', async () => {
      const sesion = await usuarioConSesion()
      const Usuario = getModel('Usuario')
      const antes = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion

      const salida = await request(app).post('/api/auth/logout').set('Cookie', sesion.access)
      expect(salida.status).toBe(200)

      const despues = (await Usuario.findOne({ where: { correo: sesion.correo } })).tokenVersion
      expect(despues).toBe(antes)
    })

    it('no invalida la sesion abierta en otro dispositivo', async () => {
      const sesion = await usuarioConSesion()

      await request(app).post('/api/auth/logout').set('Cookie', sesion.access)

      // Mismo usuario, otro dispositivo: su refresh token sigue vivo.
      expect((await renovar(sesion.refresh)).status).toBe(200)
    })
  })
  // ────────────────────────────────────────────────────────────────
  // Login con Google: el otro punto que emite tokens
  // ────────────────────────────────────────────────────────────────

  describe('sesion abierta con Google', () => {
    const googleAuthService = require('../../src/services/googleAuthService')

    // Si googleCallback emite el token SIN tokenVersion, el usuario cuyo
    // contador ya avanzo —porque alguna vez cambio o recupero su clave— queda
    // desconectado en cada renovacion, cada 20 minutos, sin motivo aparente.
    it('renueva bien aunque el contador del usuario ya haya avanzado', async () => {
      const n = ++seq
      const correo = `google-${n}@ecora.cl`
      const usuario = await createTestUser(getModel, {
        username: `google-${n}`, correo, password: CLAVE, roles: ['TRABAJADOR'],
      })
      // Simula a alguien que ya cambio su contraseña alguna vez.
      await usuario.update({ tokenVersion: 3 })

      googleAuthService.getTokensFromCode.mockResolvedValue({ access_token: 'a', refresh_token: 'r' })
      googleAuthService.getUserInfo.mockResolvedValue({
        googleId: `gid-${n}`, email: correo, name: 'Usuario Google', picture: null, verifiedEmail: true,
      })

      // El callback exige un state valido (V19), asi que hay que pasar por el
      // inicio del flujo para obtenerlo junto a su cookie.
      const inicio = await request(app).get('/api/auth/google')
      const state = new URL(inicio.body.authUrl).searchParams.get('state')
      const cookieState = cookieDe(inicio, '__oauth_state')

      const callback = await request(app)
        .get(`/api/auth/google/callback?code=fake&state=${encodeURIComponent(state)}`)
        .set('Cookie', cookieState)
      const refreshCookie = cookieDe(callback, '__refresh_token')
      expect(refreshCookie).toBeTruthy()

      expect((await renovar(refreshCookie)).status).toBe(200)
    })
  })
})
