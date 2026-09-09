// backend/tests/integration/google-oauth-seguridad.test.js
// Endurecimiento del login con Google: V18 (correo verificado) y V19 (state).
//
// V18 — auth.controller.js vincula la cuenta de Google a un usuario local
// EXISTENTE buscándolo por correo, sin mirar si Google dice que ese correo está
// verificado. googleAuthService si devuelve verifiedEmail; el controller lo
// recolecta y lo tira. Si alguien consigue un id de Google con el correo de otra
// persona sin verificarlo, se queda con la cuenta local de esa persona.
//
// V19 — googleLogin genera la URL sin parametro state, asi que el callback no
// puede distinguir una vuelta legitima de una provocada por un tercero. Eso
// permite login CSRF: dejar a la victima con la sesion del atacante abierta sin
// que lo note, y que trabaje ahi.
//
// El patron a NO repetir es el del callback de Gmail: ahi el state se decodifica
// pero no se verifica, el comentario dice que comprueba algo que no comprueba, y
// el catch no lleva return, asi que el flujo sigue igual. Aca, si el state no
// valida, el flujo se DETIENE y no se emite ninguna cookie de sesion.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser } = require('../helpers/auth')
const { hash } = require('../../src/utils/hash')
const googleAuthService = require('../../src/services/googleAuthService')

/** ¿La respuesta abrio sesion? Es la pregunta que importa en cada rechazo. */
function abrioSesion(res) {
  const cookies = res.headers['set-cookie'] || []
  return cookies.some(c => c.startsWith('__access_token=') && !c.startsWith('__access_token=;'))
}

function cookieDe(res, nombre) {
  const cookies = res.headers['set-cookie'] || []
  const encontrada = cookies.find(c => c.startsWith(`${nombre}=`))
  return encontrada ? encontrada.split(';')[0] : null
}

describe('Seguridad del login con Google', () => {
  let getModel
  let seq = 0

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
    await getModel('Rol').findOrCreate({
      where: { nombre: 'EXTERNO' },
      defaults: { nombre: 'EXTERNO', descripcion: 'Rol EXTERNO para testing' },
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    await getModel('Rol').findOrCreate({
      where: { nombre: 'EXTERNO' },
      defaults: { nombre: 'EXTERNO', descripcion: 'Rol EXTERNO para testing' },
    })
    jest.clearAllMocks()
  })

  /** Perfil que devolvera Google en el intercambio del codigo. */
  function googleResponde({ email, verifiedEmail = true, googleId }) {
    googleAuthService.getTokensFromCode.mockResolvedValue({ access_token: 'a', refresh_token: 'r' })
    googleAuthService.getUserInfo.mockResolvedValue({
      googleId: googleId || `gid-${++seq}`,
      email,
      name: 'Usuario Google',
      picture: null,
      verifiedEmail,
    })
  }

  /** Inicia el flujo y devuelve el state emitido junto a su cookie. */
  async function iniciarLogin() {
    const res = await request(app).get('/api/auth/google')
    const url = new URL(res.body.authUrl)
    return {
      state: url.searchParams.get('state'),
      cookie: cookieDe(res, '__oauth_state'),
    }
  }

  function volverDeGoogle({ state, cookie, code = 'codigo-valido' }) {
    const req = request(app).get(`/api/auth/google/callback?code=${code}${state ? `&state=${encodeURIComponent(state)}` : ''}`)
    return cookie ? req.set('Cookie', cookie) : req
  }

  // ────────────────────────────────────────────────────────────────
  // V18 — vinculacion por correo
  // ────────────────────────────────────────────────────────────────

  describe('V18: vinculacion de una cuenta Google con un usuario local existente', () => {
    async function crearUsuarioLocal(correo) {
      return getModel('Usuario').create({
        username: `local-${++seq}`,
        correo,
        password: await hash('ClaveDePrueba123'),
        estado: true,
        auth_provider: 'local',
      })
    }

    it('NO vincula cuando Google dice que el correo no esta verificado', async () => {
      const local = await crearUsuarioLocal('victima@ecora.cl')
      googleResponde({ email: 'victima@ecora.cl', verifiedEmail: false })
      const { state, cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie })

      expect(abrioSesion(res)).toBe(false)

      // Y la cuenta local queda intacta: sin google_id y sin cambiar de proveedor.
      await local.reload()
      expect(local.google_id).toBeFalsy()
      expect(local.auth_provider).toBe('local')
    })

    it('SI vincula cuando el correo viene verificado', async () => {
      const local = await crearUsuarioLocal('legitimo@ecora.cl')
      googleResponde({ email: 'legitimo@ecora.cl', verifiedEmail: true })
      const { state, cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie })

      expect(abrioSesion(res)).toBe(true)
      await local.reload()
      expect(local.google_id).toBeTruthy()
    })

    it('NO crea una cuenta nueva con un correo sin verificar', async () => {
      googleResponde({ email: 'nuevo-sin-verificar@ecora.cl', verifiedEmail: false })
      const { state, cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie })

      expect(abrioSesion(res)).toBe(false)
      const creado = await getModel('Usuario').findOne({ where: { correo: 'nuevo-sin-verificar@ecora.cl' } })
      expect(creado).toBeNull()
    })

    it('no revela en la respuesta por que fue rechazado', async () => {
      await crearUsuarioLocal('otra-victima@ecora.cl')
      googleResponde({ email: 'otra-victima@ecora.cl', verifiedEmail: false })
      const { state, cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie })

      expect(res.text.toLowerCase()).not.toContain('verified')
      expect(res.text.toLowerCase()).not.toContain('no verificado')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // V19 — state firmado y verificado
  // ────────────────────────────────────────────────────────────────

  describe('V19: parametro state del login con Google', () => {
    it('la URL de autorizacion incluye un state', async () => {
      const { state } = await iniciarLogin()

      expect(state).toBeTruthy()
    })

    it('el inicio deja una cookie para atar el state a este navegador', async () => {
      const { cookie } = await iniciarLogin()

      expect(cookie).toBeTruthy()
    })

    // Sin esto la firma no protegeria de nada: el atacante inicia su propio
    // login, obtiene un state legitimamente firmado y lo usa en el ataque.
    it('rechaza un state valido que no corresponde a este navegador', async () => {
      const victima = await iniciarLogin()
      const atacante = await iniciarLogin()
      googleResponde({ email: 'nuevo@ecora.cl' })

      const res = await volverDeGoogle({ state: atacante.state, cookie: victima.cookie })

      expect(abrioSesion(res)).toBe(false)
    })

    it('rechaza el callback sin state', async () => {
      googleResponde({ email: 'nuevo2@ecora.cl' })
      const { cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state: null, cookie })

      expect(abrioSesion(res)).toBe(false)
    })

    it('rechaza un state fabricado', async () => {
      googleResponde({ email: 'nuevo3@ecora.cl' })
      const { cookie } = await iniciarLogin()
      const fabricado = Buffer.from(JSON.stringify({ nonce: 'inventado', ts: Date.now() })).toString('base64url')

      const res = await volverDeGoogle({ state: fabricado, cookie })

      expect(abrioSesion(res)).toBe(false)
    })

    it('rechaza un state con la firma alterada', async () => {
      googleResponde({ email: 'nuevo4@ecora.cl' })
      const { state, cookie } = await iniciarLogin()
      const alterado = state.slice(0, -4) + 'AAAA'

      const res = await volverDeGoogle({ state: alterado, cookie })

      expect(abrioSesion(res)).toBe(false)
    })

    it('rechaza cuando falta la cookie del navegador', async () => {
      googleResponde({ email: 'nuevo5@ecora.cl' })
      const { state } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie: null })

      expect(abrioSesion(res)).toBe(false)
    })

    it('acepta el flujo completo y legitimo', async () => {
      googleResponde({ email: 'legitimo2@ecora.cl' })
      const { state, cookie } = await iniciarLogin()

      const res = await volverDeGoogle({ state, cookie })

      expect(abrioSesion(res)).toBe(true)
    })

    // El fallo del state tiene que DETENER el flujo, no solo registrarlo: es el
    // error exacto del callback de Gmail, donde el catch no lleva return.
    it('un state invalido detiene el flujo antes de tocar la base de datos', async () => {
      googleResponde({ email: 'no-debe-existir@ecora.cl' })
      const { cookie } = await iniciarLogin()

      await volverDeGoogle({ state: 'basura', cookie })

      const creado = await getModel('Usuario').findOne({ where: { correo: 'no-debe-existir@ecora.cl' } })
      expect(creado).toBeNull()
      expect(googleAuthService.getTokensFromCode).not.toHaveBeenCalled()
    })
  })
})
