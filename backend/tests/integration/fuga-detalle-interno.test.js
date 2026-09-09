// backend/tests/integration/fuga-detalle-interno.test.js
// V21: detalle interno devuelto al cliente saltandose el errorHandler.
//
// El errorHandler central (middleware/errorHandler.js) si oculta el mensaje del
// error en produccion, pero varios controladores responden por su cuenta con
// `details: error.message` y nunca llegan a el. Ahi se filtra lo que diga la
// excepcion: rutas de archivos, nombres de tabla, mensajes de la API de Google,
// cadenas de conexion.
//
// Todas las comprobaciones corren con config.isProd forzado a true. Sin eso
// medirian el mensaje de DESARROLLO, donde mostrar el detalle es deliberado, y
// no dirian nada sobre produccion, que es lo que importa. Es la leccion del
// caso del errorHandler y los handlers async.

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => 'un-refresh-token'),
  storage: 'file',
}))

jest.mock('../../src/services/gmailService', () => ({
  initialize: jest.fn(async () => {
    throw new Error('ENOENT: no such file or directory, open /app/secrets/gmail.json')
  }),
  processEmails: jest.fn(),
  searchEmails: jest.fn(),
  getEmail: jest.fn(),
  parseEmailContent: jest.fn(),
  getAllAttachmentParts: jest.fn(),
  downloadAttachment: jest.fn(),
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')
const { config } = require('../../src/config')

// Fragmentos del mensaje de la excepcion simulada que NO deben salir al cliente.
const FILTRACIONES = ['ENOENT', '/app/secrets', 'gmail.json', 'no such file']

/** Comprueba que ninguna parte del detalle interno aparezca en la respuesta. */
function noFiltra(res) {
  const cuerpo = JSON.stringify(res.body ?? '') + (res.text || '')
  for (const fragmento of FILTRACIONES) {
    expect(cuerpo).not.toContain(fragmento)
  }
}

describe('V21: detalle interno en las respuestas de error', () => {
  let getModel
  let admin
  const isProdOriginal = config.isProd

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    await seedRoles(getModel)
    admin = await createTestUser(getModel, {
      username: 'admin-fuga', correo: 'admin-fuga@ecora.cl', roles: ['ADMIN'],
    })
  })

  afterAll(async () => {
    config.isProd = isProdOriginal
    await db.__closeTestDb()
  })

  beforeEach(() => {
    // Sin esto se estaria midiendo el mensaje de desarrollo.
    config.isProd = true
  })

  afterEach(() => {
    config.isProd = isProdOriginal
  })

  describe('POST /api/gmail/process', () => {
    it('no devuelve el mensaje de la excepcion', async () => {
      const res = await request(app)
        .post('/api/gmail/process')
        .set(authHeader(admin))
        .send({ credentials: { refresh_token: 'x' } })

      expect(res.status).toBe(500)
      noFiltra(res)
    })
  })

  describe('POST /api/gmail/preview', () => {
    it('no devuelve el mensaje de la excepcion', async () => {
      const res = await request(app)
        .post('/api/gmail/preview')
        .set(authHeader(admin))
        .send({ credentials: { refresh_token: 'x' } })

      expect(res.status).toBe(500)
      noFiltra(res)
    })
  })

  describe('GET /api/gmail/auth-url', () => {
    it('no devuelve el mensaje de la excepcion', async () => {
      const clientId = process.env.GMAIL_CLIENT_ID
      // Sin client_id el handler responde 500 por su cuenta.
      delete process.env.GMAIL_CLIENT_ID
      const googleId = process.env.GOOGLE_CLIENT_ID
      delete process.env.GOOGLE_CLIENT_ID
      try {
        const res = await request(app).get('/api/gmail/auth-url').set(authHeader(admin))

        expect(res.status).toBe(500)
        // El mensaje puede ser propio, pero no debe traer detalle de excepcion.
        expect(res.body.details).toBeUndefined()
      } finally {
        if (clientId !== undefined) process.env.GMAIL_CLIENT_ID = clientId
        if (googleId !== undefined) process.env.GOOGLE_CLIENT_ID = googleId
      }
    })
  })

  describe('POST /api/referidos/sync/gmail', () => {
    it('no devuelve el mensaje de la excepcion', async () => {
      const res = await request(app)
        .post('/api/referidos/sync/gmail')
        .set(authHeader(admin))
        .send({})

      noFiltra(res)
      expect(res.body.details).toBeUndefined()
    })
  })

  describe('GET /api/referidos/sync/gmail/preview (SSE)', () => {
    it('no devuelve el mensaje de la excepcion en el evento de error', async () => {
      const res = await request(app)
        .get('/api/referidos/sync/gmail/preview')
        .set(authHeader(admin))

      // La respuesta es un stream de texto, no JSON.
      for (const fragmento of FILTRACIONES) {
        expect(res.text || '').not.toContain(fragmento)
      }
    })
  })

  // En desarrollo el detalle SI se muestra y es deliberado: sirve para depurar.
  // Queda fijado para que nadie lo confunda con un defecto y lo quite.
  describe('en desarrollo', () => {
    it('si muestra el detalle', async () => {
      config.isProd = false

      const res = await request(app)
        .post('/api/gmail/process')
        .set(authHeader(admin))
        .send({ credentials: { refresh_token: 'x' } })

      expect(res.body.details).toBeDefined()
    })
  })
})
