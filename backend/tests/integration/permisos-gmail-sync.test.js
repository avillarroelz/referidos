// backend/tests/integration/permisos-gmail-sync.test.js
// Matriz de permisos por rol sobre los endpoints de Gmail y de sincronizacion
// de referidos desde Gmail. Estas rutas son operaciones administrativas: solo
// RRHH / JefeRRHH / ADMIN deben alcanzarlas. TRABAJADOR y EXTERNO deben recibir
// 403, y el corte tiene que ocurrir en la ruta (requireRoles), no dentro del
// controller: si vive en el controller, un body invalido devuelve 400 antes de
// evaluar el rol y filtra informacion de validacion a quien no debe estar ahi.

// El token de sincronizacion queda sin configurar para que ningun caso feliz
// salga a la red de Gmail.
jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => null),
  storage: 'file',
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

/**
 * Crea el rol EXTERNO. seedRoles() de tests/helpers/auth.js solo siembra
 * TRABAJADOR, RRHH, ADMIN y ADC; findOrCreate lo deja idempotente para cuando
 * EXTERNO se incorpore al helper compartido.
 */
async function seedRolExterno(getModel) {
  const Rol = getModel('Rol')
  const [rol] = await Rol.findOrCreate({
    where: { nombre: 'EXTERNO' },
    defaults: { nombre: 'EXTERNO', descripcion: 'Rol EXTERNO para testing' },
  })
  return rol
}

const ROLES_PRIVILEGIADOS = ['RRHH', 'ADMIN', 'JefeRRHH']
// auth-url queda en RRHH/ADMIN: el callback no valida que la cuenta autorizada
// sea la casilla de reclutamiento. JefeRRHH se niega a proposito.
const ROLES_ADMIN_Y_RRHH = ['RRHH', 'ADMIN']

// Los endpoints bajo prueba. `statusAutorizado` es el codigo funcional que
// devuelve el handler cuando el rol si tiene permiso y Gmail no esta
// configurado (nunca 401 ni 403).
const ENDPOINTS = [
  {
    nombre: 'GET /api/gmail/status',
    method: 'get',
    path: '/api/gmail/status',
    statusAutorizado: 200,
    autorizados: ROLES_PRIVILEGIADOS,
    denegados: ['TRABAJADOR', 'EXTERNO'],
  },
  {
    nombre: 'GET /api/gmail/auth-url',
    method: 'get',
    path: '/api/gmail/auth-url',
    statusAutorizado: 200,
    autorizados: ROLES_ADMIN_Y_RRHH,
    denegados: ['TRABAJADOR', 'EXTERNO', 'JefeRRHH'],
  },
  {
    nombre: 'POST /api/referidos/sync/gmail',
    method: 'post',
    path: '/api/referidos/sync/gmail',
    body: {},
    statusAutorizado: 400, // Gmail no configurado
    autorizados: ROLES_PRIVILEGIADOS,
    denegados: ['TRABAJADOR', 'EXTERNO'],
  },
  {
    nombre: 'GET /api/referidos/sync/gmail/preview',
    method: 'get',
    path: '/api/referidos/sync/gmail/preview',
    statusAutorizado: 200, // SSE: abre el stream y emite event: error
    autorizados: ROLES_PRIVILEGIADOS,
    denegados: ['TRABAJADOR', 'EXTERNO'],
  },
  {
    nombre: 'POST /api/referidos/sync/gmail/manual',
    method: 'post',
    path: '/api/referidos/sync/gmail/manual',
    body: {
      referidos: [{ messageId: 'msg-permisos-1', nombre: 'Candidato Prueba' }],
    },
    statusAutorizado: 200,
    autorizados: ROLES_PRIVILEGIADOS,
    denegados: ['TRABAJADOR', 'EXTERNO'],
  },
]

describe('Permisos de endpoints Gmail y sync de referidos', () => {
  let getModel
  const clientIdOriginal = process.env.GMAIL_CLIENT_ID

  beforeAll(async () => {
    // getAuthUrl responde 500 sin client_id; lo fijamos para que el caso
    // autorizado sea determinista y no dependa del .env de la maquina.
    process.env.GMAIL_CLIENT_ID = 'test-gmail-client-id'
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
    await seedRolExterno(getModel)
  })

  afterAll(async () => {
    if (clientIdOriginal === undefined) delete process.env.GMAIL_CLIENT_ID
    else process.env.GMAIL_CLIENT_ID = clientIdOriginal
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    await seedRolExterno(getModel)
  })

  /** Ejecuta la peticion con el header del usuario indicado. */
  function llamar(endpoint, user) {
    const req = request(app)[endpoint.method](endpoint.path).set(authHeader(user))
    return endpoint.body === undefined ? req : req.send(endpoint.body)
  }

  describe.each(ENDPOINTS)('$nombre', (endpoint) => {
    it.each(endpoint.denegados)('debe responder 403 para el rol %s', async (rol) => {
      const user = await createTestUser(getModel, {
        username: `u-${rol.toLowerCase()}`,
        correo: `${rol.toLowerCase()}@test.com`,
        roles: [rol],
      })

      const res = await llamar(endpoint, user)

      expect(res.status).toBe(403)
    })

    it.each(endpoint.autorizados)(
      `debe responder ${endpoint.statusAutorizado} para el rol %s`,
      async (rol) => {
        const user = await createTestUser(getModel, {
          username: `u-${rol.toLowerCase()}`,
          correo: `${rol.toLowerCase()}@test.com`,
          roles: [rol],
        })

        const res = await llamar(endpoint, user)

        expect(res.status).toBe(endpoint.statusAutorizado)
      }
    )

    it('debe responder 401 sin autenticacion', async () => {
      const req = request(app)[endpoint.method](endpoint.path)
      const res = endpoint.body === undefined ? await req : await req.send(endpoint.body)

      expect(res.status).toBe(401)
    })
  })

  // Retiradas: recibian un refresh_token por body y repuntaban el singleton de
  // gmailService a otra cuenta de Google. El front no las usaba.
  describe.each([
    ['post', '/api/gmail/process'],
    ['post', '/api/gmail/preview'],
  ])('%s %s (retirada)', (method, path) => {
    it.each(['RRHH', 'ADMIN', 'JefeRRHH', 'TRABAJADOR', 'EXTERNO'])('debe responder 404 para el rol %s', async (rol) => {
      const user = await createTestUser(getModel, {
        username: `u-${rol.toLowerCase()}`,
        correo: `${rol.toLowerCase()}@test.com`,
        roles: [rol],
      })

      const res = await request(app)[method](path).set(authHeader(user)).send({})

      expect(res.status).toBe(404)
    })
  })

  // El corte por rol debe ganarle a la validacion del body: con requireRoles en
  // la ruta, un rol sin permiso recibe 403 aunque el payload sea invalido.
  describe('el rol se evalua antes que la validacion del body', () => {
    const CON_VALIDATORS = [
      { nombre: 'POST /api/referidos/sync/gmail', path: '/api/referidos/sync/gmail', body: { maxResults: 9999 } },
      { nombre: 'POST /api/referidos/sync/gmail/manual', path: '/api/referidos/sync/gmail/manual', body: { referidos: [] } },
    ]

    it.each(CON_VALIDATORS)('$nombre responde 403 a TRABAJADOR con body invalido', async ({ path, body }) => {
      const user = await createTestUser(getModel, {
        username: 'u-trabajador-invalido',
        correo: 'trabajador-invalido@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app).post(path).set(authHeader(user)).send(body)

      expect(res.status).toBe(403)
    })
  })
})
