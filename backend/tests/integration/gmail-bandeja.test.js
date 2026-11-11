// backend/tests/integration/gmail-bandeja.test.js
//
// Modulo Gmail: registro de correos revisados (importados y descartados),
// historial, restauracion, vista previa de adjuntos y adjuntar a una ficha
// existente. Ver odd/tasks/modulo-gmail-bandeja.md (contrato de API).

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => 'un-refresh-token'),
  storage: 'file',
}))

jest.mock('../../src/services/gmailService', () => ({
  initialize: jest.fn(async () => {}),
  getEmail: jest.fn(),
  getAllAttachmentParts: jest.fn(() => []),
  downloadAttachment: jest.fn(),
  extractTextFromFile: jest.fn(),
  markAsRead: jest.fn(async () => {}),
  addLabel: jest.fn(async () => {}),
}))

jest.mock('../../src/services/s3Service', () => ({
  isConfigured: jest.fn(() => true),
  generateReferidoFileKey: jest.fn((rut, id, nombre) => `referidos/${id}/${nombre}`),
  uploadFile: jest.fn(async () => {}),
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const gmailService = require('../../src/services/gmailService')
const tokenStore = require('../../src/services/gmailTokenStore')
const s3Service = require('../../src/services/s3Service')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

describe('Modulo Gmail: bandeja', () => {
  let getModel
  let Revisado
  let Referido
  let rrhh

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    Revisado = getModel('GmailCorreoRevisado')
    Referido = getModel('Referido')
    await seedRoles(getModel)
    rrhh = await createTestUser(getModel, {
      username: 'rrhh-bandeja', correo: 'rrhh-bandeja@ecora.cl', roles: ['RRHH'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    await Revisado.destroy({ where: {} })
    await Referido.destroy({ where: {} })
  })

  describe('POST /api/gmail/correos/descartar', () => {
    const descartar = (correos) => request(app)
      .post('/api/gmail/correos/descartar')
      .set(authHeader(rrhh))
      .send({ correos })

    it('anota los correos como descartados con quien los descarto', async () => {
      const res = await descartar([
        { messageId: 'm1', from: 'Ana <ana@x.cl>', subject: 'CV Ana' },
        { messageId: 'm2' },
      ])

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, descartados: 2 })
      const fila = await Revisado.findOne({ where: { gmailMessageId: 'm1' } })
      expect(fila.estado).toBe('descartado')
      expect(fila.remitente).toBe('Ana <ana@x.cl>')
      expect(fila.asunto).toBe('CV Ana')
      expect(fila.revisadoPorUsuarioId).toBe(rrhh.id)
      expect(await Revisado.count()).toBe(2)
    })

    it('es idempotente: repetir no falla ni duplica', async () => {
      await descartar([{ messageId: 'm1' }])

      const res = await descartar([{ messageId: 'm1' }, { messageId: 'm1' }])

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, descartados: 0 })
      expect(await Revisado.count()).toBe(1)
    })

    it('no pisa un correo ya importado', async () => {
      await Revisado.create({ gmailMessageId: 'm1', estado: 'importado' })

      const res = await descartar([{ messageId: 'm1' }])

      expect(res.status).toBe(200)
      expect((await Revisado.findOne({ where: { gmailMessageId: 'm1' } })).estado).toBe('importado')
    })

    it.each([
      ['sin correos', []],
      ['mas de 100', Array.from({ length: 101 }, (_, i) => ({ messageId: `m${i}` }))],
      ['messageId con caracteres no permitidos', [{ messageId: 'a b/../c' }]],
      ['messageId vacio', [{ messageId: '' }]],
      ['from que no es string', [{ messageId: 'm1', from: 5 }]],
    ])('rechaza con 400: %s', async (_nombre, correos) => {
      const res = await descartar(correos)
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/gmail/correos/historial', () => {
    beforeEach(async () => {
      await Revisado.create({ gmailMessageId: 'a', estado: 'descartado', remitente: 'r1', asunto: 's1', revisadoPorUsuarioId: rrhh.id })
      await Revisado.create({ gmailMessageId: 'b', estado: 'importado', remitente: 'r2', asunto: 's2', revisadoPorUsuarioId: null })
      await Revisado.create({ gmailMessageId: 'c', estado: 'descartado', revisadoPorUsuarioId: rrhh.id })
    })

    const historial = (qs = '') => request(app).get(`/api/gmail/correos/historial${qs}`).set(authHeader(rrhh))

    it('pagina, ordena del mas reciente y trae quien reviso', async () => {
      const res = await historial()

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(3)
      expect(res.body.page).toBe(1)
      expect(res.body.pageSize).toBe(20)
      expect(res.body.items.map(i => i.messageId)).toEqual(['c', 'b', 'a'])
      const a = res.body.items.find(i => i.messageId === 'a')
      expect(a).toMatchObject({
        estado: 'descartado', remitente: 'r1', asunto: 's1', referidoId: null,
        revisadoPor: { id: rrhh.id, nombre: rrhh.username },
      })
      expect(a.fecha).toBeTruthy()
      expect(res.body.items.find(i => i.messageId === 'b').revisadoPor).toBeNull()
    })

    it('filtra por estado', async () => {
      const res = await historial('?estado=importado')

      expect(res.body.total).toBe(1)
      expect(res.body.items.map(i => i.messageId)).toEqual(['b'])
    })

    it('respeta page y pageSize', async () => {
      const res = await historial('?page=2&pageSize=2')

      expect(res.body.total).toBe(3)
      expect(res.body.pageSize).toBe(2)
      expect(res.body.items.map(i => i.messageId)).toEqual(['a'])
    })

    it.each(['?estado=otro', '?page=0', '?pageSize=0', '?pageSize=101'])('rechaza %s con 400', async (qs) => {
      const res = await historial(qs)
      expect(res.status).toBe(400)
    })
  })

  describe('DELETE /api/gmail/correos/:messageId', () => {
    const restaurar = (id) => request(app).delete(`/api/gmail/correos/${id}`).set(authHeader(rrhh))

    it('restaura un descartado borrando la fila', async () => {
      await Revisado.create({ gmailMessageId: 'm1', estado: 'descartado' })

      const res = await restaurar('m1')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(await Revisado.count()).toBe(0)
    })

    it('409 si el correo esta importado, y no lo borra', async () => {
      await Revisado.create({ gmailMessageId: 'm1', estado: 'importado' })

      const res = await restaurar('m1')

      expect(res.status).toBe(409)
      expect(await Revisado.count()).toBe(1)
    })

    it('404 si no existe', async () => {
      const res = await restaurar('nada')
      expect(res.status).toBe(404)
    })

    it('400 con un messageId invalido', async () => {
      const res = await restaurar('a.b')
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/gmail/correos/:messageId/adjuntos/:index', () => {
    const parte = (extra = {}) => ({
      filename: 'cv.pdf', mimeType: 'application/pdf', attachmentId: 'ATT-1', size: 100, ...extra,
    })
    const pdfBuffer = Buffer.from('%PDF-1.4 contenido del cv')

    // Respuesta binaria completa, sin que supertest intente interpretarla.
    const binario = (req) => req.buffer(true).parse((res, cb) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    const pedir = (index = 0, messageId = 'msg1') => binario(
      request(app).get(`/api/gmail/correos/${messageId}/adjuntos/${index}`).set(authHeader(rrhh))
    )

    beforeEach(() => {
      gmailService.getEmail.mockResolvedValue({ payload: {} })
      gmailService.getAllAttachmentParts.mockReturnValue([parte()])
      gmailService.downloadAttachment.mockResolvedValue(pdfBuffer)
    })

    it('entrega el PDF inline con cabeceras fijas', async () => {
      const res = await pedir()

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.headers['content-disposition']).toBe('inline; filename="documento.pdf"')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['cache-control']).toBe('no-store')
      expect(Buffer.compare(res.body, pdfBuffer)).toBe(0)
      expect(gmailService.downloadAttachment).toHaveBeenCalledWith('msg1', 'ATT-1')
    })

    it('usa el indice como posicion en getAllAttachmentParts', async () => {
      gmailService.getAllAttachmentParts.mockReturnValue([
        parte({ filename: 'foto.png', mimeType: 'image/png', attachmentId: 'ATT-0' }),
        parte({ attachmentId: 'ATT-1' }),
      ])

      const res = await pedir(1)

      expect(res.status).toBe(200)
      expect(gmailService.downloadAttachment).toHaveBeenCalledWith('msg1', 'ATT-1')
    })

    it('nunca refleja el mimetype ni el nombre que vienen del correo', async () => {
      gmailService.getAllAttachmentParts.mockReturnValue([
        parte({ filename: '"><script>.pdf', mimeType: 'text/html' }),
      ])

      const res = await pedir()

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('application/pdf')
      expect(res.headers['content-disposition']).toBe('inline; filename="documento.pdf"')
    })

    it('acepta el %PDF- dentro de los primeros 1024 bytes', async () => {
      gmailService.downloadAttachment.mockResolvedValue(Buffer.concat([Buffer.alloc(500, 0x20), pdfBuffer]))
      expect((await pedir()).status).toBe(200)
    })

    it.each([
      ['no empieza con %PDF-', Buffer.from('<html><script>alert(1)</script></html>')],
      ['%PDF- pasado el byte 1024', Buffer.concat([Buffer.alloc(2000, 0x20), pdfBuffer])],
    ])('415 si dice ser PDF pero %s', async (_n, buffer) => {
      gmailService.downloadAttachment.mockResolvedValue(buffer)

      const res = await pedir()

      expect(res.status).toBe(415)
      expect(res.headers['content-type']).not.toMatch(/pdf/)
    })

    it.each([
      ['cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['nota.txt', 'text/plain'],
    ])('%s se entrega como texto plano extraido', async (filename, mimeType) => {
      gmailService.getAllAttachmentParts.mockReturnValue([parte({ filename, mimeType })])
      gmailService.downloadAttachment.mockResolvedValue(Buffer.from('binario'))
      gmailService.extractTextFromFile.mockResolvedValue('Texto del CV')

      const res = await pedir()

      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body.toString('utf-8')).toBe('Texto del CV')
    })

    it.each([
      ['cv.doc', 'application/msword'],
      ['cv.doc', 'application/octet-stream'],
    ])('415 para Word binario (%s, %s): no hay extractor, no responde 200 vacio', async (filename, mimeType) => {
      gmailService.getAllAttachmentParts.mockReturnValue([parte({ filename, mimeType })])

      const res = await pedir()

      expect(res.status).toBe(415)
      expect(gmailService.extractTextFromFile).not.toHaveBeenCalled()
    })

    it('415 para otros tipos, sin descargar el adjunto', async () => {
      gmailService.getAllAttachmentParts.mockReturnValue([parte({ filename: 'virus.exe', mimeType: 'application/x-msdownload' })])

      const res = await pedir()

      expect(res.status).toBe(415)
      expect(gmailService.downloadAttachment).not.toHaveBeenCalled()
    })

    it('413 si el adjunto pesa mas de 10 MB, sin descargarlo', async () => {
      gmailService.getAllAttachmentParts.mockReturnValue([parte({ size: 10 * 1024 * 1024 + 1 })])

      const res = await pedir()

      expect(res.status).toBe(413)
      expect(gmailService.downloadAttachment).not.toHaveBeenCalled()
    })

    it('404 si el indice no existe', async () => {
      const res = await pedir(3)
      expect(res.status).toBe(404)
    })

    it('502 si Gmail no entrega el adjunto', async () => {
      gmailService.downloadAttachment.mockResolvedValue(null)
      const res = await pedir()
      expect(res.status).toBe(502)
    })

    it('no escribe nada a disco', async () => {
      const fs = require('fs')
      const escribir = jest.spyOn(fs, 'writeFileSync')
      const mkdir = jest.spyOn(fs, 'mkdirSync')

      await pedir()

      expect(escribir).not.toHaveBeenCalled()
      expect(mkdir).not.toHaveBeenCalled()
      escribir.mockRestore()
      mkdir.mockRestore()
    })

    it.each([['50', 'msg1'], ['-1', 'msg1'], ['x', 'msg1'], ['0', 'a.b']])(
      '400 con parametros invalidos (index=%s, messageId=%s)', async (index, messageId) => {
        const res = await pedir(index, messageId)
        expect(res.status).toBe(400)
      }
    )

    it('400 requiresSetup si la casilla no esta conectada', async () => {
      tokenStore.getSyncRefreshToken.mockResolvedValueOnce(null)

      const res = await request(app).get('/api/gmail/correos/msg1/adjuntos/0').set(authHeader(rrhh))

      expect(res.status).toBe(400)
      expect(res.body.requiresSetup).toBe(true)
    })

    // 424 y no 401: el cliente HTTP del frontend trata todo 401 como sesion vencida.
    it('424 requiresAuth si Google rechaza el token', async () => {
      gmailService.getEmail.mockRejectedValue(new Error('invalid_grant'))

      const res = await request(app).get('/api/gmail/correos/msg1/adjuntos/0').set(authHeader(rrhh))

      expect(res.status).toBe(424)
      expect(res.body.requiresAuth).toBe(true)
    })

    it('404 si el correo no existe en Gmail', async () => {
      gmailService.getEmail.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }))

      const res = await request(app).get('/api/gmail/correos/msg1/adjuntos/0').set(authHeader(rrhh))

      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/gmail/correos/:messageId/adjuntar', () => {
    let ficha
    const parte = (extra = {}) => ({
      filename: 'cv.pdf', mimeType: 'application/pdf', attachmentId: 'ATT-1', size: 100, ...extra,
    })

    beforeEach(async () => {
      ficha = await Referido.create({ nombre: 'Ficha Existente', rut: '1-9', creadoPorUserId: rrhh.id })
      s3Service.isConfigured.mockReturnValue(true)
      gmailService.getEmail.mockResolvedValue({ payload: {} })
      gmailService.getAllAttachmentParts.mockReturnValue([parte()])
      gmailService.downloadAttachment.mockResolvedValue(Buffer.from('%PDF-1.4 cv'))
    })

    const adjuntar = (body, messageId = 'msg1') => request(app)
      .post(`/api/gmail/correos/${messageId}/adjuntar`)
      .set(authHeader(rrhh))
      .send(body)

    it('guarda los adjuntos en la ficha, anota el correo como importado y lo marca procesado', async () => {
      gmailService.getAllAttachmentParts.mockReturnValue([
        parte(),
        parte({ filename: 'enorme.pdf', attachmentId: 'ATT-2', size: 10 * 1024 * 1024 + 1 }),
      ])

      const res = await adjuntar({ referidoId: ficha.id, from: 'Ana <a@x.cl>', subject: 'CV nuevo' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, adjuntosGuardados: 1 })
      const docs = await getModel('Documento').findAll({ where: { referidoId: ficha.id } })
      expect(docs).toHaveLength(1)
      expect(docs[0]).toMatchObject({ nombre: 'cv.pdf', s3Key: `referidos/${ficha.id}/cv.pdf`, mimetype: 'application/pdf' })
      expect(s3Service.uploadFile).toHaveBeenCalledTimes(1)
      const fila = await Revisado.findOne({ where: { gmailMessageId: 'msg1' } })
      expect(fila).toMatchObject({
        estado: 'importado', referidoId: ficha.id, remitente: 'Ana <a@x.cl>', asunto: 'CV nuevo',
        revisadoPorUsuarioId: rrhh.id,
      })
      expect(gmailService.markAsRead).toHaveBeenCalledWith('msg1')
      expect(gmailService.addLabel).toHaveBeenCalledWith('msg1', 'Referido-Procesado')
    })

    // Ley 21.719: el nombre del archivo de un CV casi siempre trae el nombre de la persona.
    it.each([
      ['S3 correcto', () => {}],
      ['S3 falla y queda copia local', () => s3Service.uploadFile.mockRejectedValueOnce(new Error('S3 caido'))],
      ['sin S3, copia local', () => s3Service.isConfigured.mockReturnValue(false)],
    ])('los logs no llevan el nombre del archivo ni su ruta (%s)', async (_n, preparar) => {
      const fs = require('fs')
      const { logger } = require('../../src/utils/logger')
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const espias = ['log', 'warn', 'error'].map(m => jest.spyOn(console, m).mockImplementation(() => {}))
      espias.push(jest.spyOn(logger, 'error').mockImplementation(() => {}))
      preparar()
      gmailService.getAllAttachmentParts.mockReturnValue([parte({ filename: 'Juan Perez Soto CV.pdf' })])

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(200)
      const logs = JSON.stringify(espias.map(e => e.mock.calls))
      expect(logs).not.toMatch(/Juan|Perez|Soto/i)
      expect(logs).not.toContain('.pdf')
      jest.restoreAllMocks()
    })

    it('si S3 falla deja la copia local, sin s3Key', async () => {
      const fs = require('fs')
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
      const escribir = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      s3Service.uploadFile.mockRejectedValueOnce(new Error('S3 caido'))

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.body.adjuntosGuardados).toBe(1)
      expect(escribir).toHaveBeenCalledTimes(1)
      const doc = await getModel('Documento').findOne({ where: { referidoId: ficha.id } })
      expect(doc.s3Key).toBeNull()
      expect(doc.ruta).toMatch(/^uploads\/referidos\//)
      jest.restoreAllMocks()
    })

    it('404 si la ficha no existe, sin tocar Gmail ni anotar', async () => {
      const res = await adjuntar({ referidoId: 999999 })

      expect(res.status).toBe(404)
      expect(gmailService.getEmail).not.toHaveBeenCalled()
      expect(await Revisado.count()).toBe(0)
    })

    it.each(['importado', 'descartado'])('409 si el correo ya esta anotado (%s), sin bajar adjuntos', async (estado) => {
      await Revisado.create({ gmailMessageId: 'msg1', estado })

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(409)
      expect(gmailService.downloadAttachment).not.toHaveBeenCalled()
      expect(await getModel('Documento').count()).toBe(0)
    })

    it('409 si el correo ya es el origen de otro referido (import automatico), sin bajar adjuntos', async () => {
      await Referido.create({ nombre: 'Otra Ficha', creadoPorUserId: rrhh.id, gmailMessageId: 'msg1' })

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(409)
      expect(gmailService.downloadAttachment).not.toHaveBeenCalled()
      expect(await getModel('Documento').count()).toBe(0)
      expect(await Revisado.count()).toBe(0)
    })

    it.each([
      ['el correo no tiene adjuntos', []],
      ['todos superan los 10 MB', [parte({ size: 10 * 1024 * 1024 + 1 })]],
    ])('422 si no se guardo ningun documento (%s): no deja anotado ni marca el correo', async (_n, partes) => {
      gmailService.getAllAttachmentParts.mockReturnValue(partes)

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(422)
      expect(res.body).toEqual({ error: 'El correo no tiene documentos que se puedan adjuntar' })
      expect(await Revisado.count()).toBe(0)
      expect(gmailService.markAsRead).not.toHaveBeenCalled()
      expect(gmailService.addLabel).not.toHaveBeenCalled()
    })

    it('422 si todos los adjuntos fallaron al guardarse', async () => {
      gmailService.downloadAttachment.mockRejectedValue(new Error('descarga fallida'))
      jest.spyOn(console, 'warn').mockImplementation(() => {})

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(422)
      expect(await Revisado.count()).toBe(0)
      expect(gmailService.markAsRead).not.toHaveBeenCalled()
      console.warn.mockRestore()
    })

    it('si Gmail falla no deja el correo anotado (se puede reintentar)', async () => {
      gmailService.getEmail.mockRejectedValue(new Error('boom'))
      jest.spyOn(console, 'error').mockImplementation(() => {})

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(500)
      expect(await Revisado.count()).toBe(0)
      console.error.mockRestore()
    })

    it('424 requiresAuth si Google rechaza el token, tampoco anota', async () => {
      gmailService.getEmail.mockRejectedValue(new Error('invalid_grant'))

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(424)
      expect(res.body.requiresAuth).toBe(true)
      expect(await Revisado.count()).toBe(0)
    })

    it('400 requiresSetup si la casilla no esta conectada', async () => {
      tokenStore.getSyncRefreshToken.mockResolvedValueOnce(null)

      const res = await adjuntar({ referidoId: ficha.id })

      expect(res.status).toBe(400)
      expect(res.body.requiresSetup).toBe(true)
      expect(await Revisado.count()).toBe(0)
    })

    it.each([
      ['sin referidoId', {}],
      ['referidoId no numerico', { referidoId: 'abc' }],
      ['referidoId cero', { referidoId: 0 }],
      ['from que no es string', { referidoId: 1, from: 7 }],
    ])('400: %s', async (_n, body) => {
      const res = await adjuntar(body)
      expect(res.status).toBe(400)
    })

    it('400 con un messageId invalido', async () => {
      const res = await adjuntar({ referidoId: ficha.id }, 'a.b')
      expect(res.status).toBe(400)
    })
  })
})
