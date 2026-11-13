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
    await getModel('GmailCorreoRevisado').destroy({ where: {} })
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
      // acaba de crear, y el create choca con el indice UNIQUE. Tampoco lo ve el
      // registro de revisados (que ahora tambien se consulta antes de crear).
      jest.spyOn(Referido, 'findOne').mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      jest.spyOn(getModel('GmailCorreoRevisado'), 'findOne').mockResolvedValueOnce(null)

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

  // El import anota el correo en el registro de revisados para que no vuelva a
  // salir en el analisis (modulo Gmail).
  describe('POST /api/referidos/sync/gmail/manual: registro de correos revisados', () => {
    const enviar = (item) => request(app)
      .post('/api/referidos/sync/gmail/manual')
      .set(authHeader(rrhh))
      .send({ referidos: [item] })

    it('anota el correo como importado, con el referido, remitente, asunto y quien importo', async () => {
      const res = await enviar({
        messageId: 'msg-reg-1', nombre: 'Ana Perez', from: 'Ana <ana@x.cl>', subject: 'CV Ana',
      })

      expect(res.body.created).toBe(1)
      const fila = await getModel('GmailCorreoRevisado').findOne({ where: { gmailMessageId: 'msg-reg-1' } })
      expect(fila).toMatchObject({
        estado: 'importado',
        referidoId: res.body.referidos[0].id,
        remitente: 'Ana <ana@x.cl>',
        asunto: 'CV Ana',
        revisadoPorUsuarioId: rrhh.id,
      })
    })

    it('from y subject son opcionales', async () => {
      const res = await enviar({ messageId: 'msg-reg-2', nombre: 'Sin Cabeceras' })

      expect(res.body.created).toBe(1)
      const fila = await getModel('GmailCorreoRevisado').findOne({ where: { gmailMessageId: 'msg-reg-2' } })
      expect(fila.estado).toBe('importado')
      expect(fila.remitente).toBeNull()
      expect(fila.asunto).toBeNull()
    })

    it('un correo que estaba descartado pasa a importado', async () => {
      await getModel('GmailCorreoRevisado').create({ gmailMessageId: 'msg-reg-3', estado: 'descartado' })

      const res = await enviar({ messageId: 'msg-reg-3', nombre: 'Rescatado' })

      expect(res.body.created).toBe(1)
      const filas = await getModel('GmailCorreoRevisado').findAll({ where: { gmailMessageId: 'msg-reg-3' } })
      expect(filas).toHaveLength(1)
      expect(filas[0]).toMatchObject({ estado: 'importado', referidoId: res.body.referidos[0].id })
    })

    it('un duplicado (mismo email) no anota el correo', async () => {
      await enviar({ messageId: 'msg-reg-4', nombre: 'Primero', email: 'dup@x.cl' })

      const res = await enviar({ messageId: 'msg-reg-5', nombre: 'Segundo', email: 'dup@x.cl' })

      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(/^Duplicado: ya existe referido #\d+$/)
      expect(await getModel('GmailCorreoRevisado').count({ where: { gmailMessageId: 'msg-reg-5' } })).toBe(0)
    })

    it('un duplicado que solo difiere en formato (RUT con puntos, correo en mayusculas) tampoco se crea', async () => {
      await enviar({ messageId: 'msg-fmt-1', nombre: 'Primero', email: 'Dup@X.cl', rut: '12345678-5' })

      const porRut = await enviar({ messageId: 'msg-fmt-2', nombre: 'Segundo', rut: '12.345.678-5' })
      const porCorreo = await enviar({ messageId: 'msg-fmt-3', nombre: 'Tercero', email: 'dup@x.CL' })

      for (const res of [porRut, porCorreo]) {
        expect(res.body.created).toBe(0)
        expect(res.body.errors[0].error).toMatch(/^Duplicado: ya existe referido #\d+$/)
      }
      expect(await Referido.count()).toBe(1)
    })

    // El servidor decide: el correo es "de relleno" si coincide con el From del propio item.
    it('correo igual al From del item (de relleno): distinto nombre se importa, mismo nombre es duplicado', async () => {
      const from = 'Consultora <rrhh@consultora.cl>'
      const a = await enviar({ messageId: 'msg-rem-1', nombre: 'Uno Soto', email: 'rrhh@consultora.cl', from })
      const b = await enviar({ messageId: 'msg-rem-2', nombre: 'Dos Rojas', email: 'RRHH@consultora.cl', from })

      expect(a.body.created).toBe(1)
      expect(b.body.created).toBe(1)
      expect(await Referido.count()).toBe(2)

      const c = await enviar({ messageId: 'msg-rem-3', nombre: 'UNO  SOTO', email: 'rrhh@consultora.cl', from })
      expect(c.body.created).toBe(0)
      expect(c.body.errors[0].error).toMatch(/^Duplicado: ya existe referido #\d+$/)
    })

    it('un correo distinto del From sigue siendo identidad, aunque el cliente mande emailDesdeRemitente: true', async () => {
      await enviar({ messageId: 'msg-rem-4', nombre: 'Uno', email: 'maria@gmail.com', from: 'Maria <maria@gmail.com>' })

      const res = await enviar({
        messageId: 'msg-rem-5', nombre: 'Otro Nombre', email: 'maria@gmail.com',
        from: 'Consultora <rrhh@consultora.cl>', emailDesdeRemitente: true,
      })

      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(/^Duplicado: ya existe referido #\d+$/)
    })

    it('un RUT con DV invalido ya guardado igual detecta al mismo texto como duplicado', async () => {
      await enviar({ messageId: 'msg-dv-1', nombre: 'Primero', rut: '12.345.678-9' })

      const res = await enviar({ messageId: 'msg-dv-2', nombre: 'Segundo', rut: '12.345.678-9' })

      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(/^Duplicado: ya existe referido #\d+$/)
    })

    it('si anotar falla, el import igual se completa y el aviso no lleva datos personales', async () => {
      jest.spyOn(getModel('GmailCorreoRevisado'), 'create').mockRejectedValueOnce(new Error('registro caido'))
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await enviar({
        messageId: 'msg-reg-6', nombre: 'Persona Secreta', from: 'secreta@x.cl', subject: 'Asunto Secreto',
      })

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(1)
      expect(res.body.errors).toHaveLength(0)
      expect(await Referido.count({ where: { gmailMessageId: 'msg-reg-6' } })).toBe(1)
      expect(warn).toHaveBeenCalled()
      const logs = JSON.stringify(warn.mock.calls)
      expect(logs).not.toMatch(/Secret/)
    })

    // El bloque de adjuntos vive ahora en services/gmailAdjuntos.js: lo que se
    // importa sigue guardandose como documento del referido.
    it('guarda los adjuntos del correo como documentos del referido y los cuenta', async () => {
      const fs = require('fs')
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      gmailService.getAllAttachmentParts.mockReturnValueOnce([
        { filename: 'cv ana.pdf', mimeType: 'application/pdf', attachmentId: 'A1', size: 10 },
      ])
      gmailService.downloadAttachment.mockResolvedValueOnce(Buffer.from('%PDF-1.4'))

      const res = await enviar({ messageId: 'msg-reg-8', nombre: 'Con Adjunto' })

      expect(res.body.adjuntosGuardados).toBe(1)
      const docs = await getModel('Documento').findAll({ where: { referidoId: res.body.referidos[0].id } })
      expect(docs).toHaveLength(1)
      expect(docs[0].nombre).toBe('cv ana.pdf')
      expect(gmailService.downloadAttachment).toHaveBeenCalledWith('msg-reg-8', 'A1')
      expect(gmailService.markAsRead).toHaveBeenCalledWith('msg-reg-8')
      expect(gmailService.addLabel).toHaveBeenCalledWith('msg-reg-8', 'Referido-Procesado')
    })

    it('un correo ya importado (p. ej. adjuntado a otra ficha) es Duplicado: no crea la persona ni pisa el registro', async () => {
      const otra = await Referido.create({ nombre: 'Ficha Original', creadoPorUserId: rrhh.id })
      await getModel('GmailCorreoRevisado').create({
        gmailMessageId: 'msg-reg-9', estado: 'importado', referidoId: otra.id,
      })

      const res = await enviar({ messageId: 'msg-reg-9', nombre: 'Persona Nueva' })

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors).toHaveLength(1)
      expect(res.body.errors[0].error).toBe('Duplicado: este correo ya fue importado')
      expect(await Referido.count({ where: { nombre: 'Persona Nueva' } })).toBe(0)
      const fila = await getModel('GmailCorreoRevisado').findOne({ where: { gmailMessageId: 'msg-reg-9' } })
      expect(fila.referidoId).toBe(otra.id)
    })

    it('from que no es texto se rechaza con 400', async () => {
      const res = await enviar({ messageId: 'msg-reg-7', nombre: 'X', from: 123 })
      expect(res.status).toBe(400)
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

    it('anota como importado el correo que crea', async () => {
      const res = await importarAuto()

      expect(res.body.created).toBe(1)
      const ref = await Referido.findOne({ where: { nombre: 'Candidato Auto' } })
      const fila = await getModel('GmailCorreoRevisado').findOne({ where: { gmailMessageId: 'msg-auto-1' } })
      expect(fila).toMatchObject({ estado: 'importado', referidoId: ref.id, revisadoPorUsuarioId: rrhh.id })
    })

    it('se salta un correo descartado: cuenta skipped, no lo analiza ni crea nada', async () => {
      await getModel('GmailCorreoRevisado').create({ gmailMessageId: 'msg-auto-1', estado: 'descartado' })

      const res = await importarAuto()

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.skipped).toBe(1)
      expect(res.body.errors).toHaveLength(0)
      expect(gmailService.processOneEmail).not.toHaveBeenCalled()
      expect(await Referido.count()).toBe(0)
      expect((await getModel('GmailCorreoRevisado').findOne({ where: { gmailMessageId: 'msg-auto-1' } })).estado).toBe('descartado')
    })

    it('no crea a quien ya existe con otro formato de RUT o correo: cuenta skipped', async () => {
      await Referido.create({
        nombre: 'Ya Existe', rut: '12345678-5', email: 'Ya@X.cl', creadoPorUserId: rrhh.id,
      })
      gmailService.processOneEmail.mockResolvedValue({
        id: 'msg-auto-1',
        extractedData: { nombre: 'Ya Existe', rut: '12.345.678-5', email: 'ya@x.cl' },
      })

      const res = await importarAuto()

      expect(res.body.created).toBe(0)
      expect(res.body.skipped).toBe(1)
      expect(await Referido.count()).toBe(1)
    })

    it('el correo rellenado desde el remitente no omite a un postulante de OTRO nombre', async () => {
      await Referido.create({ nombre: 'Otro', email: 'rrhh@consultora.cl', creadoPorUserId: rrhh.id })
      gmailService.searchEmails.mockResolvedValue([{ id: 'msg-auto-1' }, { id: 'msg-auto-2' }])
      gmailService.processOneEmail.mockImplementation(async (id) => ({
        id,
        extractedData: { nombre: `Postulante ${id}`, email: 'rrhh@consultora.cl', rellenadoDesdeRemitente: ['email'] },
      }))

      const res = await importarAuto()

      expect(res.body.created).toBe(2)
      expect(res.body.skipped).toBe(0)
    })

    it('el correo rellenado + mismo nombre que un referido existente: se omite (skipped)', async () => {
      await Referido.create({ nombre: 'María Pérez', email: 'maria@gmail.com', creadoPorUserId: rrhh.id })
      gmailService.searchEmails.mockResolvedValue([{ id: 'msg-auto-1' }])
      gmailService.processOneEmail.mockResolvedValue({
        id: 'msg-auto-1',
        extractedData: { nombre: 'MARIA PEREZ', email: 'maria@gmail.com', rellenadoDesdeRemitente: ['nombre', 'email'] },
      })

      const res = await importarAuto()

      expect(res.body.created).toBe(0)
      expect(res.body.skipped).toBe(1)
    })

    it('violacion de UNIQUE por carrera: Duplicado, no error generico', async () => {
      await importarAuto()
      // Ni el chequeo previo ni el registro de revisados ven al ganador de la carrera.
      jest.spyOn(Referido, 'findOne').mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      jest.spyOn(getModel('GmailCorreoRevisado'), 'findOne').mockResolvedValueOnce(null)

      const res = await importarAuto()

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toMatch(DUPLICADO)
      expect(await Referido.count()).toBe(1)
    })
  })
})
