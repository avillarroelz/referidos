// backend/tests/integration/gmail-callback-state.test.js
// V1: el callback OAuth de Gmail y el parametro state.
//
// GET /api/gmail/oauth2callback es publico (antes del router.use(authRequired)),
// y eso es correcto para un callback. El problema era lo que hacia con el state:
//
//   - lo decodificaba pero NO lo verificaba: sin firma, sin nonce y sin registro
//     de los state emitidos, cualquiera podia fabricar uno;
//   - el bloque iba dentro de `if (state)`, o sea el state era OPCIONAL;
//   - el catch solo escribia en consola y NO llevaba return, asi que un state
//     corrupto tampoco detenia nada;
//   - el comentario decia "verificar que es un admin" y el rol no se comprobaba.
//
// Consecuencia: quien completara un consentimiento OAuth contra el client_id de
// Ecora con SU propia casilla y cayera en el callback sobrescribia el
// refresh_token de sincronizacion de toda la empresa, dejandola leyendo los
// correos del atacante, y el unico rastro —configured_by— lo elegia el.
//
// Estos casos empezaron en rojo, midiendo el agujero, y quedaron verdes con el
// fix. El state ahora se emite y se verifica con src/lib/oauthState.js, y el
// rol del solicitante se comprueba CONTRA LA BASE, no contra el payload.

const TOKEN_DEL_ATACANTE = 'refresh-token-de-la-casilla-del-atacante'
const CORREO_DEL_ATACANTE = 'atacante@gmail.com'
const CASILLA_DE_RECLUTAMIENTO = 'reclutamiento@ecora.cl'

// La cuenta que "autoriza" en Google. Prefijo mock: lo lee la fabrica de jest.mock.
let mockCorreoAutorizado = CORREO_DEL_ATACANTE

// Sustituye el intercambio real con Google: el codigo se canjea "con exito" por
// las credenciales de una casilla cualquiera.
jest.mock('googleapis', () => {
  const getToken = jest.fn(async () => ({
    tokens: { refresh_token: 'refresh-token-de-la-casilla-del-atacante', access_token: 'acceso' },
  }))
  return {
    google: {
      auth: { OAuth2: jest.fn(() => ({ getToken, setCredentials: jest.fn() })) },
      gmail: jest.fn(() => ({
        users: { getProfile: jest.fn(async () => ({ data: { emailAddress: mockCorreoAutorizado } })) },
      })),
    },
  }
})

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => null),
  storage: 'file',
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const tokenStore = require('../../src/services/gmailTokenStore')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

/** State como lo construye hoy getAuthUrl: base64 de un JSON, sin firma. */
function stateFabricado(userId) {
  return Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64')
}

const volverDeGoogle = (state) =>
  request(app).get(`/api/gmail/oauth2callback?code=codigo${state ? `&state=${encodeURIComponent(state)}` : ''}`)

describe('V1: callback OAuth de Gmail y el parametro state', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // ────────────────────────────────────────────────────────────────
  // Lo que un atacante puede hacer hoy
  // ────────────────────────────────────────────────────────────────

  describe('un state que el backend nunca emitio', () => {
    it('no debe guardar el token cuando el state viene fabricado', async () => {
      await volverDeGoogle(stateFabricado(1))

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    it('no debe guardar el token cuando NO viene state', async () => {
      // El bloque esta dentro de `if (state)`, asi que omitirlo es la via mas
      // simple: ni siquiera hace falta fabricar nada.
      await volverDeGoogle(null)

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    it('no debe guardar el token cuando el state es basura sin decodificar', async () => {
      // El catch del decodificado solo hace console.error y no corta.
      await volverDeGoogle('%%%no-es-base64%%%')

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    it('no debe canjear el codigo antes de validar el state', async () => {
      const { google } = require('googleapis')

      await volverDeGoogle(stateFabricado(1))

      // El intercambio tiene que ocurrir DESPUES de validar, no antes: si no, un
      // tercero puede provocar llamadas a Google desde nuestras credenciales.
      expect(google.auth.OAuth2).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────
  // El impacto concreto, para dimensionar la vulnerabilidad
  // ────────────────────────────────────────────────────────────────

  describe('impacto sobre la casilla de sincronizacion', () => {
    it('no debe sobrescribir el refresh_token global de la empresa', async () => {
      await volverDeGoogle(stateFabricado(1))

      const guardado = tokenStore.saveConfig.mock.calls[0]?.[0]
      expect(guardado?.refresh_token).not.toBe(TOKEN_DEL_ATACANTE)
    })

    it('no debe dejar la sincronizacion apuntando a una casilla ajena', async () => {
      await volverDeGoogle(stateFabricado(1))

      const guardado = tokenStore.saveConfig.mock.calls[0]?.[0]
      expect(guardado?.email).not.toBe(CORREO_DEL_ATACANTE)
    })

    // configured_by es el unico rastro de quien conecto la casilla, y hoy lo
    // elige quien fabrica el state: se puede incriminar a un tercero.
    it('no debe registrar como responsable a un usuario elegido por quien llama', async () => {
      const ID_INCRIMINADO = 42

      await volverDeGoogle(stateFabricado(ID_INCRIMINADO))

      const guardado = tokenStore.saveConfig.mock.calls[0]?.[0]
      expect(guardado?.configured_by).not.toBe(ID_INCRIMINADO)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // El control que el comentario dice hacer y no hace
  // ────────────────────────────────────────────────────────────────

  describe('rol del usuario del state', () => {
    // gmailController.js:211 dice "Decodificar state para verificar que es un
    // admin". El rol no se comprueba en ninguna parte del callback.
    it('no debe aceptar un state cuyo usuario no existe siquiera', async () => {
      await volverDeGoogle(stateFabricado(999999))

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })
  })
  // ────────────────────────────────────────────────────────────────
  // Flujo legitimo y guarda de rol, con un state que SI valida
  // ────────────────────────────────────────────────────────────────
  //
  // Los casos de arriba se rechazan por el state. Estos usan un state real,
  // emitido por el propio backend, para llegar hasta la comprobacion de rol y
  // verificar que se hace CONTRA LA BASE y no contra lo que dice el payload.

  describe('con un state emitido por el propio backend', () => {
    let getModel
    let seq = 0
    const clientIdOriginal = process.env.GMAIL_CLIENT_ID
    const casillaOriginal = process.env.GMAIL_SYNC_EMAIL

    beforeAll(async () => {
      process.env.GMAIL_CLIENT_ID = 'test-gmail-client-id'
      // Sin la variable rige el valor por defecto, que es lo que se prueba.
      delete process.env.GMAIL_SYNC_EMAIL
      const instancia = await db.__initTestDb()
      getModel = instancia.getModel
      await seedRoles(getModel)
    })

    afterAll(async () => {
      if (clientIdOriginal === undefined) delete process.env.GMAIL_CLIENT_ID
      else process.env.GMAIL_CLIENT_ID = clientIdOriginal
      if (casillaOriginal !== undefined) process.env.GMAIL_SYNC_EMAIL = casillaOriginal
      mockCorreoAutorizado = CORREO_DEL_ATACANTE
      await db.__closeTestDb()
    })

    beforeEach(async () => {
      mockCorreoAutorizado = CASILLA_DE_RECLUTAMIENTO
      await db.__resetTestDb()
      await seedRoles(getModel)
    })

    /** Pide la URL de autorizacion como `usuario` y extrae state y cookie. */
    async function iniciarConexion(usuario) {
      const res = await request(app).get('/api/gmail/auth-url').set(authHeader(usuario))
      expect(res.status).toBe(200)
      const state = new URL(res.body.authUrl).searchParams.get('state')
      const cookies = res.headers['set-cookie'] || []
      const cookie = cookies.find(c => c.startsWith('__oauth_state='))?.split(';')[0]
      return { state, cookie }
    }

    const volverConCookie = (state, cookie) =>
      request(app)
        .get(`/api/gmail/oauth2callback?code=codigo&state=${encodeURIComponent(state)}`)
        .set('Cookie', cookie)

    async function crear(rol) {
      const n = ++seq
      return createTestUser(getModel, {
        username: `u-${rol}-${n}`, correo: `${rol}-${n}@ecora.cl`, roles: [rol],
      })
    }

    it('un ADMIN completa la conexion y el token queda guardado', async () => {
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).toHaveBeenCalledTimes(1)
      const guardado = tokenStore.saveConfig.mock.calls[0][0]
      expect(guardado.refresh_token).toBe(TOKEN_DEL_ATACANTE) // el que devolvio Google
      // configured_by sale del state firmado, no de lo que mande quien llama.
      expect(guardado.configured_by).toBe(admin.id)
    })

    it.each(['RRHH', 'JefeRRHH'])('un %s tambien puede conectar la casilla', async (rol) => {
      const usuario = await crear(rol)
      const { state, cookie } = await iniciarConexion(usuario)

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).toHaveBeenCalledTimes(1)
      expect(tokenStore.saveConfig.mock.calls[0][0].email).toBe(CASILLA_DE_RECLUTAMIENTO)
    })

    // La casilla es fija: un rol autorizado que consiente con OTRA cuenta de
    // Google (la suya, por descuido o a proposito) no puede repuntar la
    // sincronizacion de toda la empresa.
    it('rechaza una cuenta de Google que no es la casilla de reclutamiento', async () => {
      mockCorreoAutorizado = 'otra.persona@ecora.cl'
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)

      const res = await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
      expect(res.headers.location).toContain('gmail_error=wrong_account')
    })

    it('acepta la casilla aunque Google la devuelva con otras mayusculas', async () => {
      mockCorreoAutorizado = 'Reclutamiento@Ecora.cl'
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).toHaveBeenCalledTimes(1)
    })

    // Una variable en blanco no puede dejar la casilla vacia (rechazaria todo).
    it('con GMAIL_SYNC_EMAIL en blanco rige la casilla por defecto', async () => {
      process.env.GMAIL_SYNC_EMAIL = '   '
      const admin = await crear('ADMIN')
      try {
        const { state, cookie } = await iniciarConexion(admin)
        await volverConCookie(state, cookie)
      } finally {
        delete process.env.GMAIL_SYNC_EMAIL
      }

      expect(tokenStore.saveConfig).toHaveBeenCalledTimes(1)
    })

    it('la URL de autorizacion sugiere la casilla de reclutamiento', async () => {
      const admin = await crear('ADMIN')

      const res = await request(app).get('/api/gmail/auth-url').set(authHeader(admin))

      expect(new URL(res.body.authUrl).searchParams.get('login_hint')).toBe(CASILLA_DE_RECLUTAMIENTO)
    })

    // La comprobacion es contra la BASE: un state valido emitido para alguien
    // que ya no existe no puede seguir sirviendo.
    it('rechaza si el usuario del state ya no existe', async () => {
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)
      await admin.destroy()

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    // Mismo motivo: el payload dice a quien se emitio el state, no si esa
    // persona conserva el permiso.
    it('rechaza si el usuario del state fue deshabilitado despues', async () => {
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)
      await admin.update({ estado: false })

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    it('rechaza si al usuario del state le quitaron el rol', async () => {
      const admin = await crear('ADMIN')
      const { state, cookie } = await iniciarConexion(admin)
      await getModel('UsuarioRol').destroy({ where: { usuarioId: admin.id } })

      await volverConCookie(state, cookie)

      expect(tokenStore.saveConfig).not.toHaveBeenCalled()
    })

    it('un TRABAJADOR no puede ni siquiera pedir la URL de conexion', async () => {
      const trabajador = await crear('TRABAJADOR')

      const res = await request(app).get('/api/gmail/auth-url').set(authHeader(trabajador))

      expect(res.status).toBe(403)
    })
  })
})
