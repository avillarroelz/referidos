// backend/tests/integration/comentarios.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Comentarios API', () => {
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
  })

  // ──────────────────────────────────────────────────────────────
  // Helper: crea un referido directamente en BD
  // ──────────────────────────────────────────────────────────────

  async function crearReferidoDirecto(userId) {
    const Referido = getModel('Referido')
    return Referido.create({
      nombre: 'Referido para Comentarios',
      estado: 'PENDIENTE',
      creadoPorUserId: userId,
    })
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/referidos/:id/comentarios
  // ──────────────────────────────────────────────────────────────

  describe('GET /api/referidos/:id/comentarios', () => {
    it('retorna lista de comentarios para un referido', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_com',
        correo: 'rrhh_com@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferidoDirecto(rrhhUser.id)

      // Crear comentarios directamente en BD
      const Comentario = getModel('Comentario')
      await Comentario.create({
        referidoId: ref.id,
        autorUserId: rrhhUser.id,
        mensaje: 'Primer comentario',
        visibleParaRoles: 'RRHH,ADMIN',
      })
      await Comentario.create({
        referidoId: ref.id,
        autorUserId: rrhhUser.id,
        mensaje: 'Segundo comentario',
        visibleParaRoles: 'RRHH,ADMIN,ADC',
      })

      const res = await request(app)
        .get(`/api/referidos/${ref.id}/comentarios`)
        .set(authHeader(rrhhUser))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(2)
      expect(res.body[0].mensaje).toBe('Primer comentario')
      expect(res.body[1].mensaje).toBe('Segundo comentario')
    })
  })

  // ──────────────────────────────────────────────────────────────
  // POST /api/referidos/:id/comentarios
  // ──────────────────────────────────────────────────────────────

  describe('POST /api/referidos/:id/comentarios', () => {
    it('crea un comentario correctamente (201)', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_crear',
        correo: 'rrhh_crear@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferidoDirecto(rrhhUser.id)

      const res = await request(app)
        .post(`/api/referidos/${ref.id}/comentarios`)
        .set(authHeader(rrhhUser))
        .send({
          mensaje: 'Este es un comentario de prueba',
          visibleParaRoles: 'RRHH,ADMIN',
        })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.mensaje).toBe('Este es un comentario de prueba')
      expect(res.body.visibleParaRoles).toBe('RRHH,ADMIN')
      expect(res.body.referidoId).toBe(ref.id)
      expect(res.body.autor).toBeDefined()
      expect(res.body.autor.username).toBe('rrhh_crear')
    })

    it('falla sin mensaje (400)', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_nomsg',
        correo: 'rrhh_nomsg@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferidoDirecto(rrhhUser.id)

      const res = await request(app)
        .post(`/api/referidos/${ref.id}/comentarios`)
        .set(authHeader(rrhhUser))
        .send({ visibleParaRoles: 'RRHH' })

      expect(res.status).toBe(400)
      expect(res.body.errors).toBeDefined()
    })

    it('falla sin autenticacion (401)', async () => {
      const tempUser = await createTestUser(getModel, {
        username: 'temp_noauth',
        correo: 'temp_noauth@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferidoDirecto(tempUser.id)

      const res = await request(app)
        .post(`/api/referidos/${ref.id}/comentarios`)
        .send({ mensaje: 'Sin auth' })

      expect(res.status).toBe(401)
    })
  })

  // ──────────────────────────────────────────────────────────────
  // Visibilidad por roles
  // ──────────────────────────────────────────────────────────────

  describe('Visibilidad de comentarios por roles', () => {
    it('TRABAJADOR no ve comentarios marcados solo para RRHH', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_vis',
        correo: 'rrhh_vis@test.com',
        roles: ['RRHH'],
      })

      const workerUser = await createTestUser(getModel, {
        username: 'worker_vis',
        correo: 'worker_vis@test.com',
        roles: ['TRABAJADOR'],
      })

      const ref = await crearReferidoDirecto(rrhhUser.id)

      // Comentario solo para RRHH
      const Comentario = getModel('Comentario')
      await Comentario.create({
        referidoId: ref.id,
        autorUserId: rrhhUser.id,
        mensaje: 'Solo RRHH',
        visibleParaRoles: 'RRHH,ADMIN',
      })

      // Comentario visible para todos incluyendo TRABAJADOR
      await Comentario.create({
        referidoId: ref.id,
        autorUserId: rrhhUser.id,
        mensaje: 'Para todos',
        visibleParaRoles: 'RRHH,ADMIN,TRABAJADOR',
      })

      // RRHH ve ambos
      const resRrhh = await request(app)
        .get(`/api/referidos/${ref.id}/comentarios`)
        .set(authHeader(rrhhUser))

      expect(resRrhh.status).toBe(200)
      expect(resRrhh.body).toHaveLength(2)

      // TRABAJADOR solo ve el que incluye su rol
      const resWorker = await request(app)
        .get(`/api/referidos/${ref.id}/comentarios`)
        .set(authHeader(workerUser))

      expect(resWorker.status).toBe(200)
      expect(resWorker.body).toHaveLength(1)
      expect(resWorker.body[0].mensaje).toBe('Para todos')
    })
  })
})
