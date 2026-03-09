// backend/tests/integration/adjuntos.test.js

// Mock S3 service antes de cualquier require que lo use
jest.mock('../../src/services/s3Service', () => ({
  initialize: jest.fn(),
  uploadFile: jest.fn().mockResolvedValue({ key: 'test-key', url: 'https://s3.example.com/test' }),
  downloadFile: jest.fn().mockResolvedValue(Buffer.from('file-content')),
  deleteFile: jest.fn().mockResolvedValue(true),
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  generateReferidoFileKey: jest.fn().mockReturnValue('referidos/test/file.pdf'),
  isConfigured: jest.fn().mockReturnValue(false),
}))

const path = require('path')
const fs = require('fs')
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

// Directorio temporal para uploads durante tests
const TEST_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'test-referidos')

describe('Adjuntos API', () => {
  let getModel

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)

    // Asegurar que el directorio de uploads para tests exista
    if (!fs.existsSync(TEST_UPLOAD_DIR)) {
      fs.mkdirSync(TEST_UPLOAD_DIR, { recursive: true })
    }
  })

  afterAll(async () => {
    await db.__closeTestDb()

    // Limpiar directorio de uploads de test
    try {
      if (fs.existsSync(TEST_UPLOAD_DIR)) {
        fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true })
      }
    } catch (_) {
      // No bloquear si falla la limpieza
    }
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
  })

  /**
   * Helper: crea un referido de prueba asociado a un usuario.
   */
  async function createTestReferido(userId, overrides = {}) {
    const Referido = getModel('Referido')
    return Referido.create({
      nombre: overrides.nombre || 'Referido Adjunto Test',
      rut: overrides.rut || null,
      telefono: '+56900000000',
      email: 'adjunto-ref@test.com',
      estado: 'PENDIENTE',
      creadoPorUserId: userId,
      ...overrides,
    })
  }

  /**
   * Helper: crea un documento (adjunto) directamente en la BD.
   */
  async function createTestDocumento(referidoId, overrides = {}) {
    const Documento = getModel('Documento')
    return Documento.create({
      nombre: overrides.nombre || 'test-file.pdf',
      ruta: overrides.ruta || 'uploads/referidos/test-file.pdf',
      mimetype: overrides.mimetype || 'application/pdf',
      size: overrides.size || 1024,
      referidoId,
      ...overrides,
    })
  }

  // ── GET /api/referidos/:id/adjuntos ─────────────────────────────────────────

  describe('GET /api/referidos/:id/adjuntos', () => {
    it('debe listar adjuntos de un referido (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin1@test.com',
        roles: ['ADMIN'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000001-1' })

      // Crear algunos adjuntos directamente en BD
      await createTestDocumento(referido.id, { nombre: 'cv.pdf' })
      await createTestDocumento(referido.id, { nombre: 'carta.pdf' })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(2)
    })

    it('debe retornar arreglo vacio si no hay adjuntos', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh1@test.com',
        roles: ['RRHH'],
      })

      const referido = await createTestReferido(rrhh.id, { rut: '10000002-2' })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(0)
    })

    it('debe retornar 404 si el referido no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .get('/api/referidos/99999/adjuntos')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).get('/api/referidos/1/adjuntos')
      expect(res.status).toBe(401)
    })
  })

  // ── POST /api/referidos/:id/adjuntos ────────────────────────────────────────

  describe('POST /api/referidos/:id/adjuntos', () => {
    it('debe subir un archivo adjunto (ADMIN, almacenamiento local)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000003-3' })

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(admin))
        .attach('files', Buffer.from('contenido de test pdf'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(201)
      expect(res.body.ok).toBe(true)
      expect(res.body.count).toBe(1)
      expect(res.body.adjuntos).toBeDefined()
      expect(res.body.adjuntos.length).toBe(1)
      expect(res.body.adjuntos[0].nombre).toBe('test.pdf')
      expect(res.body.storage).toBe('local')
    })

    it('debe subir multiples archivos', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh2',
        correo: 'rrhh2@test.com',
        roles: ['RRHH'],
      })

      const referido = await createTestReferido(rrhh.id, { rut: '10000004-4' })

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(rrhh))
        .attach('files', Buffer.from('pdf uno'), {
          filename: 'doc1.pdf',
          contentType: 'application/pdf',
        })
        .attach('files', Buffer.from('pdf dos'), {
          filename: 'doc2.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(201)
      expect(res.body.ok).toBe(true)
      expect(res.body.count).toBe(2)
      expect(res.body.adjuntos.length).toBe(2)
    })

    it('debe retornar 404 si el referido no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin4',
        correo: 'admin4@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/referidos/99999/adjuntos')
        .set(authHeader(admin))
        .attach('files', Buffer.from('test'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(404)
    })

    it('debe retornar 400 sin archivos adjuntos', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin5',
        correo: 'admin5@test.com',
        roles: ['ADMIN'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000005-5' })

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(admin))

      expect(res.status).toBe(400)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app)
        .post('/api/referidos/1/adjuntos')
        .attach('files', Buffer.from('test'), {
          filename: 'test.pdf',
          contentType: 'application/pdf',
        })

      expect(res.status).toBe(401)
    })
  })

  // ── DELETE /api/referidos/:id/adjuntos/:docId ───────────────────────────────

  describe('DELETE /api/referidos/:id/adjuntos/:docId', () => {
    it('debe eliminar un adjunto (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin6',
        correo: 'admin6@test.com',
        roles: ['ADMIN'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000006-6' })
      const doc = await createTestDocumento(referido.id, { nombre: 'borrar.pdf' })

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que ya no existe en BD
      const Documento = getModel('Documento')
      const found = await Documento.findByPk(doc.id)
      expect(found).toBeNull()
    })

    it('debe eliminar un adjunto (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh3',
        correo: 'rrhh3@test.com',
        roles: ['RRHH'],
      })

      const referido = await createTestReferido(rrhh.id, { rut: '10000007-7' })
      const doc = await createTestDocumento(referido.id, { nombre: 'borrar-rrhh.pdf' })

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('debe retornar 403 para TRABAJADOR', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin7',
        correo: 'admin7@test.com',
        roles: ['ADMIN'],
      })
      const worker = await createTestUser(getModel, {
        username: 'worker1',
        correo: 'worker1@test.com',
        roles: ['TRABAJADOR'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000008-8' })
      const doc = await createTestDocumento(referido.id, { nombre: 'protegido.pdf' })

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })

    it('debe retornar 404 si el documento no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin8',
        correo: 'admin8@test.com',
        roles: ['ADMIN'],
      })

      const referido = await createTestReferido(admin.id, { rut: '10000009-9' })

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/99999`)
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).delete('/api/referidos/1/adjuntos/1')
      expect(res.status).toBe(401)
    })
  })
})
