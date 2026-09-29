// backend/tests/integration/gmail-sync-idempotencia.test.js
//
// Idempotencia del import de Gmail por messageId. Si el cliente corta la
// request por timeout, el backend sigue importando y el usuario reintenta: sin
// esta red, los referidos sin rut ni email se duplicaban (la deduplicacion solo
// miraba esos dos campos) y dos requests concurrentes se duplicaban incluso con
// rut. El messageId de Gmail identifica el correo de origen: se guarda en
// gmail_message_id, con indice UNIQUE parcial, y un segundo import del mismo
// correo se reporta como Duplicado sin crear nada ni bajar adjuntos.

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => 'un-refresh-token'),
  storage: 'file',
}))

jest.mock('../../src/services/gmailService', () => ({
  initialize: jest.fn(async () => {}),
  searchEmails: jest.fn(async () => []),
  processOneEmail: jest.fn(),
  getEmail: jest.fn(async () => ({ payload: {} })),
  getAllAttachmentParts: jest.fn(() => []),
  downloadAttachment: jest.fn(),
  markAsRead: jest.fn(async () => {}),
  addLabel: jest.fn(async () => {}),
}))

const request = require('supertest')
const { UniqueConstraintError, ValidationErrorItem } = require('sequelize')
const { app } = require('../../src/app')
const db = require('../../src/db')
const gmailService = require('../../src/services/gmailService')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

const DUPLICADO = /^Duplicado: ya importado como referido #\d+$/

describe('Import de Gmail: idempotencia por messageId', () => {
  let getModel
  let Referido
  let rrhh

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    Referido = getModel('Referido')
    await seedRoles(getModel)
    rrhh = await createTestUser(getModel, {
      username: 'rrhh-idempotencia', correo: 'rrhh-idempotencia@ecora.cl', roles: ['RRHH'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    await Referido.destroy({ where: {} })
  })

  // Sin rut ni email a proposito: es el caso que hoy no tiene deduplicacion.
  const importarManual = (messageId) => request(app)
    .post('/api/referidos/sync/gmail/manual')
    .set(authHeader(rrhh))
    .send({ referidos: [{ messageId, nombre: 'Candidato Sin Datos' }] })

  describe('POST /api/referidos/sync/gmail/manual', () => {
    it('guarda el messageId en el referido creado', async () => {
      const res = await importarManual('msg-manual-0')

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(1)
      const ref = await Referido.findByPk(res.body.referidos[0].id)
      expect(ref.gmailMessageId).toBe('msg-manual-0')
    })

    it('el mismo messageId dos veces: la segunda es Duplicado y queda 1 solo referido', async () => {
      const primera = await importarManual('msg-manual-1')
      expect(primera.body.created).toBe(1)
      const idOriginal = primera.body.referidos[0].id
      gmailService.getEmail.mockClear()

      const segunda = await importarManual('msg-manual-1')

      expect(segunda.status).toBe(200)
      expect(segunda.body.created).toBe(0)
      expect(segunda.body.errors).toHaveLength(1)
      expect(segunda.body.errors[0].error).toMatch(DUPLICADO)
      expect(segunda.body.errors[0].error).toContain(`#${idOriginal}`)
      // Sin crear nada ni bajar adjuntos.
      expect(gmailService.getEmail).not.toHaveBeenCalled()
      expect(await Referido.count()).toBe(1)
    })

    it('violacion de UNIQUE por carrera: Duplicado, no 500', async () => {
      await importarManual('msg-carrera-manual')
      // Simula la carrera: el chequeo previo no ve el referido que otra request
      // acaba de crear, y el create choca con el indice UNIQUE.
      jest.spyOn(Referido, 'findOne').mockResolvedValueOnce(null)

      const res = await importarManual('msg-carrera-manual')

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(DUPLICADO)
      expect(await Referido.count()).toBe(1)
    })

    it('un UNIQUE de otra tabla, posterior al create, no se disfraza de Duplicado', async () => {
      // El referido ya quedo creado con su messageId cuando falla el historial:
      // si el helper aceptara cualquier UniqueConstraintError, lo encontraria y
      // reportaria un Duplicado falso, tragandose el error real.
      const EstadoHistorial = getModel('EstadoHistorial')
      jest.spyOn(EstadoHistorial, 'create').mockRejectedValueOnce(new UniqueConstraintError({
        errors: [new ValidationErrorItem('id must be unique', 'unique violation', 'id', '1')],
        fields: { id: 1 },
      }))

      const res = await importarManual('msg-unique-ajeno')

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors).toHaveLength(1)
      expect(res.body.errors[0].error).not.toMatch(/Duplicado/)
    })
  })

  describe('POST /api/referidos/sync/gmail (automatico)', () => {
    const importarAuto = () => request(app)
      .post('/api/referidos/sync/gmail')
      .set(authHeader(rrhh))
      .send({})

    beforeEach(() => {
      gmailService.searchEmails.mockResolvedValue([{ id: 'msg-auto-1' }])
      gmailService.processOneEmail.mockResolvedValue({
        id: 'msg-auto-1',
        extractedData: { nombre: 'Candidato Auto' },
      })
    })

    it('guarda el messageId en el referido creado', async () => {
      const res = await importarAuto()

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(1)
      const ref = await Referido.findOne({ where: { nombre: 'Candidato Auto' } })
      expect(ref.gmailMessageId).toBe('msg-auto-1')
    })

    it('el mismo messageId dos veces: la segunda es Duplicado y queda 1 solo referido', async () => {
      await importarAuto()
      gmailService.processOneEmail.mockClear()

      const res = await importarAuto()

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors).toHaveLength(1)
      expect(res.body.errors[0].error).toMatch(DUPLICADO)
      // processOneEmail baja adjuntos y llama a la IA: no se repite.
      expect(gmailService.processOneEmail).not.toHaveBeenCalled()
      expect(await Referido.count()).toBe(1)
    })

    it('violacion de UNIQUE por carrera: Duplicado, no error generico', async () => {
      await importarAuto()
      jest.spyOn(Referido, 'findOne').mockResolvedValueOnce(null)

      const res = await importarAuto()

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(DUPLICADO)
      expect(await Referido.count()).toBe(1)
    })
  })
})
