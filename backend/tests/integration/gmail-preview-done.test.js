// backend/tests/integration/gmail-preview-done.test.js
//
// El evento 'done' del preview SSE de Gmail reenviaba todos los correos ya
// emitidos uno a uno en eventos 'email'. El front no lo usa, y con 50 correos
// era una sola linea data: de ~100-150 KB que el parser SSE del front perdia al
// llegar partida en varios chunks: el modal quedaba cargando para siempre.
// 'done' solo debe traer el contador.

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => 'un-refresh-token'),
  storage: 'file',
}))

jest.mock('../../src/services/gmailService', () => ({
  initialize: jest.fn(async () => {}),
  searchEmails: jest.fn(async () => [{ id: 'm1' }, { id: 'm2' }]),
  processOneEmail: jest.fn(async (id) => ({
    id,
    subject: `Referido ${id}`,
    extractedData: { nombre: `Candidato ${id}` },
    parseSource: 'regex',
  })),
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

/** Devuelve el payload del primer evento SSE con ese nombre. */
function payloadDeEvento(texto, evento) {
  const bloque = texto.split('\n\n').find(b => b.startsWith(`event: ${evento}\n`))
  if (!bloque) return undefined
  return JSON.parse(bloque.split('\n').find(l => l.startsWith('data: ')).slice(6))
}

describe('GET /api/referidos/sync/gmail/preview: evento done', () => {
  let admin

  beforeAll(async () => {
    const { getModel } = await db.__initTestDb()
    await seedRoles(getModel)
    admin = await createTestUser(getModel, {
      username: 'admin-preview-done', correo: 'admin-preview-done@ecora.cl', roles: ['ADMIN'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  it('trae solo el contador, sin reenviar los correos', async () => {
    const res = await request(app)
      .get('/api/referidos/sync/gmail/preview')
      .set(authHeader(admin))

    expect(res.status).toBe(200)
    const done = payloadDeEvento(res.text, 'done')
    expect(done).toEqual({ count: 2 })
  })
})
