// backend/tests/integration/publicReferidos.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Public Referidos API', () => {
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

    // Crear un usuario ADMIN para que el controller pueda asignar creador
    await createTestUser(getModel, {
      username: 'admin_public',
      correo: 'admin_public@test.com',
      roles: ['ADMIN'],
    })
  })

  // ──────────────────────────────────────────────────────────────
  // POST /api/public/referidos
  // ──────────────────────────────────────────────────────────────

  describe('POST /api/public/referidos', () => {
    it('crea un referido sin autenticacion (201)', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Referido Publico',
          email: 'publico@test.com',
        })

      expect(res.status).toBe(201)
      expect(res.body.ok).toBe(true)
      expect(res.body.message).toBeDefined()
      expect(res.body.id).toBeDefined()
    })

    it('establece origenPublico: true', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Ref Publico Origen',
          email: 'origen@test.com',
        })

      expect(res.status).toBe(201)

      // Verificar directamente en BD
      const Referido = getModel('Referido')
      const ref = await Referido.findByPk(res.body.id)
      expect(ref.origenPublico).toBe(true)
      expect(ref.estado).toBe('PENDIENTE')
    })

    it('falla sin nombre (400)', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          email: 'sinNombre@test.com',
        })

      expect(res.status).toBe(400)
      expect(res.body.errors).toBeDefined()
    })

    it('valida formato de email (400)', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Con email malo',
          email: 'no-es-un-email',
        })

      expect(res.status).toBe(400)
      expect(res.body.errors).toBeDefined()
      // Verificar que el error es sobre el email
      const emailError = res.body.errors.find(e => e.path === 'email')
      expect(emailError).toBeDefined()
    })

    it('asigna un usuario ADMIN como creador', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Ref con Creador',
          email: 'creador@test.com',
        })

      expect(res.status).toBe(201)

      // Verificar que tiene creadoPorUserId asignado
      const Referido = getModel('Referido')
      const ref = await Referido.findByPk(res.body.id)
      expect(ref.creadoPorUserId).toBeDefined()
      expect(ref.creadoPorUserId).not.toBeNull()
    })

    it('usa RRHH como fallback si no hay ADMIN', async () => {
      // Limpiar BD y recrear solo con RRHH
      await db.__resetTestDb()
      await seedRoles(getModel)

      await createTestUser(getModel, {
        username: 'rrhh_fallback',
        correo: 'rrhh_fallback@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Ref con RRHH',
          email: 'rrhh_fb@test.com',
        })

      expect(res.status).toBe(201)

      const Referido = getModel('Referido')
      const ref = await Referido.findByPk(res.body.id)
      expect(ref.creadoPorUserId).toBeDefined()
      expect(ref.creadoPorUserId).not.toBeNull()
    })

    it('falla si no hay usuarios administrativos (500)', async () => {
      // Limpiar BD completamente, solo roles sin usuarios
      await db.__resetTestDb()
      await seedRoles(getModel)

      const res = await request(app)
        .post('/api/public/referidos')
        .send({
          nombre: 'Ref Sin Admin',
          email: 'noadmin@test.com',
        })

      expect(res.status).toBe(500)
      expect(res.body.error).toContain('administrativos')
    })
  })
})
