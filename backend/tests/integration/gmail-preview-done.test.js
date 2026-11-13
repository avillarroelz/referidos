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

// Una sola conexion para todo el archivo: cerrarla entre los dos describe deja
// al segundo sin base (SQLite en memoria).
afterAll(async () => {
  await db.__closeTestDb()
})

describe('GET /api/referidos/sync/gmail/preview: evento done', () => {
  let admin

  beforeAll(async () => {
    const { getModel } = await db.__initTestDb()
    await seedRoles(getModel)
    admin = await createTestUser(getModel, {
      username: 'admin-preview-done', correo: 'admin-preview-done@ecora.cl', roles: ['ADMIN'],
    })
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

/** Payloads de todos los eventos SSE con ese nombre, en orden. */
function payloadsDeEvento(texto, evento) {
  return texto.split('\n\n')
    .filter(b => b.startsWith(`event: ${evento}\n`))
    .map(b => JSON.parse(b.split('\n').find(l => l.startsWith('data: ')).slice(6)))
}

describe('GET /api/referidos/sync/gmail/preview: correos revisados, ya registrados y preguntas', () => {
  const gmailService = require('../../src/services/gmailService')
  let getModel
  let admin

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    await seedRoles(getModel)
    admin = await createTestUser(getModel, {
      username: 'admin-preview-rev', correo: 'admin-preview-rev@ecora.cl', roles: ['ADMIN'],
    })
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    // Un test cambia la implementacion; clearAllMocks no la restaura.
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id, subject: `Referido ${id}`, extractedData: { nombre: `Candidato ${id}` }, parseSource: 'regex',
    }))
    await getModel('GmailCorreoRevisado').destroy({ where: {} })
    await getModel('Referido').destroy({ where: {} })
  })

  const ids = (...lista) => lista.map(id => ({ id }))
  const preview = (qs = '') => request(app)
    .get(`/api/referidos/sync/gmail/preview${qs}`)
    .set(authHeader(admin))

  it('excluye los correos ya revisados y los ya importados como referido, e informa cuantos omitio', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1', 'm2', 'm3', 'm4'))
    await getModel('GmailCorreoRevisado').create({ gmailMessageId: 'm1', estado: 'descartado' })
    await getModel('Referido').create({
      nombre: 'Ya Importado', creadoPorUserId: admin.id, gmailMessageId: 'm2',
    })

    const res = await preview()

    expect(payloadDeEvento(res.text, 'total')).toEqual({ total: 2, omitidos: 2 })
    expect(gmailService.processOneEmail.mock.calls.map(c => c[0])).toEqual(['m3', 'm4'])
    expect(payloadDeEvento(res.text, 'done')).toEqual({ count: 2 })
  })

  it('con mas de 500 revisados al principio, igual aparecen los pendientes posteriores', async () => {
    const revisados = Array.from({ length: 600 }, (_, i) => `r${i}`)
    // Como Gmail: respeta el tope que se le pide.
    gmailService.searchEmails.mockImplementationOnce(async (_q, max) => ids(...revisados, 'p1', 'p2').slice(0, max))
    await getModel('GmailCorreoRevisado').bulkCreate(
      revisados.map(gmailMessageId => ({ gmailMessageId, estado: 'descartado' }))
    )

    const res = await preview()

    expect(payloadDeEvento(res.text, 'total')).toEqual({ total: 2, omitidos: 600 })
    expect(gmailService.processOneEmail.mock.calls.map(c => c[0])).toEqual(['p1', 'p2'])
  })

  it('lista hasta 2000 y recien despues de filtrar corta a maxResults', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1', 'm2', 'm3', 'm4'))
    await getModel('GmailCorreoRevisado').create({ gmailMessageId: 'm1', estado: 'importado' })

    const res = await preview('?q=in:inbox&maxResults=2')

    expect(gmailService.searchEmails).toHaveBeenCalledWith('in:inbox', 2000)
    expect(payloadDeEvento(res.text, 'total')).toEqual({ total: 2, omitidos: 1 })
    expect(gmailService.processOneEmail.mock.calls.map(c => c[0])).toEqual(['m2', 'm3'])
  })

  it('un correo restaurado (sin fila) vuelve a salir', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1'))
    const revisado = await getModel('GmailCorreoRevisado').create({ gmailMessageId: 'm1', estado: 'descartado' })
    await revisado.destroy()

    const res = await preview()

    expect(payloadDeEvento(res.text, 'total')).toEqual({ total: 1, omitidos: 0 })
  })

  it('marca yaRegistrado cuando el email o el RUT extraidos ya existen', async () => {
    const existente = await getModel('Referido').create({
      nombre: 'Persona Existente', email: 'ya@x.cl', rut: '11.111.111-1', creadoPorUserId: admin.id,
    })
    gmailService.searchEmails.mockResolvedValueOnce(ids('porEmail', 'porRut', 'nuevo', 'sinDatos'))
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id,
      extractedData: {
        porEmail: { nombre: 'A', email: 'ya@x.cl' },
        porRut: { nombre: 'B', rut: '11.111.111-1' },
        nuevo: { nombre: 'C', email: 'otro@x.cl', rut: '22.222.222-2' },
        sinDatos: { nombre: 'D' },
      }[id],
      parseSource: 'regex',
    }))

    const res = await preview()

    const porId = Object.fromEntries(payloadsDeEvento(res.text, 'email').map(e => [e.email.id, e.email]))
    expect(porId.porEmail.yaRegistrado).toEqual({ id: existente.id, nombre: 'Persona Existente' })
    expect(porId.porRut.yaRegistrado).toEqual({ id: existente.id, nombre: 'Persona Existente' })
    expect(porId.nuevo.yaRegistrado).toBeNull()
    expect(porId.sinDatos.yaRegistrado).toBeNull()
  })

  it('yaRegistrado ignora puntos/guion/k del RUT y mayusculas del correo', async () => {
    const existente = await getModel('Referido').create({
      nombre: 'Persona Existente', email: 'Juan@Gmail.com', rut: '1000005-K', creadoPorUserId: admin.id,
    })
    gmailService.searchEmails.mockResolvedValueOnce(ids('porRut', 'porEmail'))
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id,
      extractedData: {
        porRut: { nombre: 'A', rut: '1.000.005-k' },
        porEmail: { nombre: 'B', email: 'JUAN@gmail.com' },
      }[id],
      parseSource: 'regex',
    }))

    const res = await preview()

    const porId = Object.fromEntries(payloadsDeEvento(res.text, 'email').map(e => [e.email.id, e.email]))
    expect(porId.porRut.yaRegistrado).toEqual({ id: existente.id, nombre: 'Persona Existente' })
    expect(porId.porEmail.yaRegistrado).toEqual({ id: existente.id, nombre: 'Persona Existente' })
  })

  it('une a la misma persona repetida en el analisis: el primero (mas reciente) se queda y los demas traen duplicadoDe', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('nuevo', 'conRutPuntos', 'conCorreoMayus', 'otraPersona', 'sinDatos1', 'sinDatos2'))
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id,
      extractedData: {
        nuevo: { nombre: 'Ana', rut: '12345678-5', email: 'ana@x.cl' },
        conRutPuntos: { nombre: 'Ana', rut: '12.345.678-5' },
        conCorreoMayus: { nombre: 'Ana', email: 'ANA@x.cl' },
        otraPersona: { nombre: 'Luis', rut: '11111111-1', email: 'luis@x.cl' },
        sinDatos1: { nombre: 'Z' },
        sinDatos2: { nombre: 'Z' },
      }[id],
      parseSource: 'regex',
    }))

    const res = await preview()

    const porId = Object.fromEntries(payloadsDeEvento(res.text, 'email').map(e => [e.email.id, e.email]))
    expect(porId.nuevo.duplicadoDe).toBeNull()
    expect(porId.conRutPuntos.duplicadoDe).toBe('nuevo')
    expect(porId.conCorreoMayus.duplicadoDe).toBe('nuevo')
    expect(porId.otraPersona.duplicadoDe).toBeNull()
    // Sin RUT ni correo no hay con que comparar: no se unen.
    expect(porId.sinDatos1.duplicadoDe).toBeNull()
    expect(porId.sinDatos2.duplicadoDe).toBeNull()
  })

  // Correo rellenado desde el remitente = clave debil: solo identifica junto al nombre.
  it('mismo remitente (correo rellenado) y DISTINTO nombre (consultora): no se unen ni marcan yaRegistrado', async () => {
    await getModel('Referido').create({ nombre: 'Otro', email: 'rrhh@consultora.cl', creadoPorUserId: admin.id })
    gmailService.searchEmails.mockResolvedValueOnce(ids('cv1', 'cv2'))
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id,
      extractedData: { nombre: `Postulante ${id}`, email: 'rrhh@consultora.cl', rellenadoDesdeRemitente: ['email'] },
      parseSource: 'ai-doc',
    }))

    const res = await preview()

    const emails = payloadsDeEvento(res.text, 'email').map(e => e.email)
    expect(emails.map(e => e.duplicadoDe)).toEqual([null, null])
    expect(emails.map(e => e.yaRegistrado)).toEqual([null, null])
  })

  it('mismo remitente (correo rellenado) y MISMO nombre: se une y marca yaRegistrado', async () => {
    const existente = await getModel('Referido').create({ nombre: 'María Pérez', email: 'maria@gmail.com', creadoPorUserId: admin.id })
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1', 'm2'))
    gmailService.processOneEmail.mockImplementation(async (id) => ({
      id,
      extractedData: { nombre: id === 'm1' ? 'MARIA PEREZ' : 'María  Pérez', email: 'Maria@Gmail.com', rellenadoDesdeRemitente: ['nombre', 'email'] },
      parseSource: 'ai-doc',
    }))

    const res = await preview()

    const emails = payloadsDeEvento(res.text, 'email').map(e => e.email)
    expect(emails.map(e => e.duplicadoDe)).toEqual([null, 'm1'])
    expect(emails[0].yaRegistrado).toEqual({ id: existente.id, nombre: 'María Pérez' })
  })

  it('el log de progreso no lleva el nombre del candidato', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1'))
    gmailService.processOneEmail.mockResolvedValueOnce({
      id: 'm1', extractedData: { nombre: 'Pedro Soto Reyes' }, parseSource: 'ai-doc',
    })
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await preview()

    expect(payloadsDeEvento(res.text, 'email')[0].email.extractedData.nombre).toBe('Pedro Soto Reyes')
    const progreso = log.mock.calls.filter(c => String(c[0]).startsWith('[previewGmail]'))
    expect(progreso.length).toBeGreaterThan(0)
    expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toMatch(/Pedro|Soto|Reyes/)
    log.mockRestore()
    warn.mockRestore()
  })

  it('siempre entrega respuestas, vacio si no se pidieron preguntas', async () => {
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1'))

    const res = await preview()

    expect(payloadsDeEvento(res.text, 'email')[0].email.respuestas).toEqual([])
  })

  it('pasa las preguntas a processOneEmail y devuelve sus respuestas', async () => {
    const respuestas = [{ pregunta: 'Tiene licencia?', respuesta: 'si', cita: 'Licencia B' }]
    gmailService.searchEmails.mockResolvedValueOnce(ids('m1'))
    gmailService.processOneEmail.mockResolvedValueOnce({
      id: 'm1', extractedData: { nombre: 'X' }, parseSource: 'ai-doc', respuestas,
    })
    const preguntas = ['  Tiene licencia?  ']

    const res = await preview(`?preguntas=${encodeURIComponent(JSON.stringify(preguntas))}`)

    expect(gmailService.processOneEmail).toHaveBeenCalledWith('m1', ['Tiene licencia?'])
    expect(payloadsDeEvento(res.text, 'email')[0].email.respuestas).toEqual(respuestas)
  })

  it.each([
    ['no es JSON', 'esto no es json'],
    ['no es un arreglo', JSON.stringify({ a: 1 })],
    ['arreglo vacio', JSON.stringify([])],
    ['mas de 5', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f'])],
    ['un elemento no string', JSON.stringify([5])],
    ['un elemento vacio', JSON.stringify(['   '])],
    ['un elemento de mas de 200 caracteres', JSON.stringify(['x'.repeat(201)])],
  ])('preguntas invalidas (%s): evento error y no consulta Gmail', async (_nombre, crudo) => {
    const res = await preview(`?preguntas=${encodeURIComponent(crudo)}`)

    expect(payloadDeEvento(res.text, 'error')).toEqual({ error: 'Preguntas no válidas' })
    expect(gmailService.searchEmails).not.toHaveBeenCalled()
    expect(gmailService.processOneEmail).not.toHaveBeenCalled()
  })
})
