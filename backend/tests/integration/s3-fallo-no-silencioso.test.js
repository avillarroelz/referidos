// backend/tests/integration/s3-fallo-no-silencioso.test.js
// Cuando la subida a S3 falla, el codigo cae al disco local pero s3Key ya quedo
// asignado antes del intento: la fila afirma que el archivo esta en S3 y no esta,
// y la descarga responde NoSuchKey. Ademas el fallo se registraba con
// console.warn, invisible para cualquier alerta.
//
// Aca S3 esta configurado (isConfigured -> true) y uploadFile siempre falla:
// es exactamente el escenario que perdio un CV en produccion.



jest.mock('../../src/services/s3Service', () => ({
  initialize: jest.fn(),
  isConfigured: jest.fn().mockReturnValue(true),
  uploadFile: jest.fn().mockRejectedValue(new Error('S3 caido')),
  deleteFile: jest.fn().mockResolvedValue(true),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
  generateReferidoFileKey: jest.fn().mockReturnValue('referidos/test/archivo.pdf'),
  generateFeedbackFileKey: jest.fn().mockReturnValue('feedback/test/imagen.png'),
}))

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logSecurityEvent: jest.fn(),
}))

jest.mock('../../src/services/gmailService', () => ({
  getEmail: jest.fn().mockResolvedValue({ payload: {} }),
  getAllAttachmentParts: jest.fn().mockReturnValue([
    { filename: 'cv-gmail.pdf', mimeType: 'application/pdf', size: 100, attachmentId: 'att-1' },
  ]),
  downloadAttachment: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 gmail')),
  initialize: jest.fn(),
}))

// Solo el token de sync: el resto del controlador sigue siendo el real porque
// gmail.routes.js monta sus handlers al cargar la app.
jest.mock('../../src/controllers/gmailController', () => ({
  ...jest.requireActual('../../src/controllers/gmailController'),
  getSyncRefreshToken: jest.fn().mockResolvedValue('refresh-token-falso'),
}))

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { logger } = require('../../src/utils/logger')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('el fallo de S3 no deja la fila mintiendo ni pasa en silencio', () => {
  let getModel

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
    logger.error.mockClear()
  })

  it('postulacion publica: el CV queda con s3Key null y ruta local, y el fallo se registra', async () => {
    await createTestUser(getModel, { username: 'admin-s3', correo: 'admin-s3@ecora.cl', roles: ['ADMIN'] })

    const res = await request(app)
      .post('/api/public/postulaciones')
      .field({
        nombre: 'Ana', apellidoPaterno: 'Soto', fechaNacimiento: '1990-05-05',
        telefono: '+56911111111', cargoPostulado: 'Analista', rut: '11111111-1',
      })
      .attach('cv', PDF, 'cv.pdf')

    expect([200, 201]).toContain(res.status)

    const doc = await getModel('Documento').findOne({ order: [['id', 'DESC']] })
    expect(doc).not.toBeNull()
    expect(doc.s3Key).toBeNull()
    expect(doc.ruta.startsWith('uploads/')).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('adjuntos del referido: el documento queda con s3Key null y ruta local, y el fallo se registra', async () => {
    const rrhh = await createTestUser(getModel, { username: 'rrhh-s3', correo: 'rrhh-s3@ecora.cl', roles: ['RRHH'] })
    const referido = await getModel('Referido').create({
      nombre: 'Ref S3', email: 'refs3@test.com', estado: 'PENDIENTE', creadoPorUserId: rrhh.id,
    })

    const res = await request(app)
      .post(`/api/referidos/${referido.id}/adjuntos`)
      .set(authHeader(rrhh))
      .attach('files', PDF, 'contrato.pdf')

    expect([200, 201]).toContain(res.status)

    const doc = await getModel('Documento').findOne({ where: { referidoId: referido.id } })
    expect(doc).not.toBeNull()
    expect(doc.s3Key).toBeNull()
    expect(doc.ruta.startsWith('uploads/')).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('imagen de feedback: la metadata queda con s3Key null y ruta local, y el fallo se registra', async () => {
    const user = await createTestUser(getModel, { username: 'user-s3', correo: 'user-s3@ecora.cl', roles: ['TRABAJADOR'] })

    const res = await request(app)
      .post('/api/feedback')
      .set(authHeader(user))
      .field({ mensaje: 'La pantalla se cae al guardar' })
      .attach('imagenes', PNG, 'captura.png')

    expect([200, 201]).toContain(res.status)

    const fb = await getModel('Feedback').findOne({ order: [['id', 'DESC']] })
    expect(fb).not.toBeNull()
    const imagenes = Array.isArray(fb.imagenes) ? fb.imagenes : []
    expect(imagenes).toHaveLength(1)
    expect(imagenes[0].s3Key).toBeNull()
    expect(String(imagenes[0].ruta).startsWith('uploads/')).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })

  it('sync manual de Gmail: el adjunto importado queda con s3Key null y ruta local, y el fallo se registra', async () => {
    const rrhh = await createTestUser(getModel, { username: 'rrhh-gmail', correo: 'rrhh-gmail@ecora.cl', roles: ['RRHH'] })

    const res = await request(app)
      .post('/api/referidos/sync/gmail/manual')
      .set(authHeader(rrhh))
      .send({ referidos: [{ messageId: 'msg-1', nombre: 'Pedro Gmail', email: 'pedro@test.com' }] })

    expect(res.status).toBe(200)

    const doc = await getModel('Documento').findOne({ where: { nombre: 'cv-gmail.pdf' } })
    expect(doc).not.toBeNull()
    expect(doc.s3Key).toBeNull()
    expect(doc.ruta.startsWith('uploads/')).toBe(true)
    expect(logger.error).toHaveBeenCalled()
  })
})
