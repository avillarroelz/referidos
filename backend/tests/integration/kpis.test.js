// backend/tests/integration/kpis.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('KPIs API', () => {
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

  /**
   * Helper: crea un referido con un estado determinado.
   * Requiere que ya exista un usuario creador.
   */
  async function createReferido(userId, overrides = {}) {
    const Referido = getModel('Referido')
    return Referido.create({
      nombre: overrides.nombre || 'Referido Test',
      rut: overrides.rut || null,
      telefono: overrides.telefono || '+56900000000',
      email: overrides.email || 'referido@test.com',
      estado: overrides.estado || 'PENDIENTE',
      creadoPorUserId: userId,
      ...overrides,
    })
  }

  // ── GET /api/kpis/overview ──────────────────────────────────────────────────

  describe('GET /api/kpis/overview', () => {
    it('debe retornar conteo por estado (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin1@test.com',
        roles: ['ADMIN'],
      })

      // Crear referidos con distintos estados
      await createReferido(admin.id, { nombre: 'R1', rut: '10000001-1', estado: 'PENDIENTE' })
      await createReferido(admin.id, { nombre: 'R2', rut: '10000002-2', estado: 'PENDIENTE' })
      await createReferido(admin.id, { nombre: 'R3', rut: '10000003-3', estado: 'EN_REVISION' })
      await createReferido(admin.id, { nombre: 'R4', rut: '10000004-4', estado: 'RECHAZADO' })

      const res = await request(app)
        .get('/api/kpis/overview')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('range')
      expect(res.body).toHaveProperty('total')
      expect(res.body).toHaveProperty('byEstado')
      expect(res.body.total).toBe(4)
      expect(res.body.byEstado.PENDIENTE).toBe(2)
      expect(res.body.byEstado.EN_REVISION).toBe(1)
      expect(res.body.byEstado.RECHAZADO).toBe(1)
    })

    it('debe retornar conteo por estado (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh1@test.com',
        roles: ['RRHH'],
      })

      await createReferido(rrhh.id, { nombre: 'R5', rut: '10000005-5', estado: 'PENDIENTE' })

      const res = await request(app)
        .get('/api/kpis/overview')
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
    })

    it('debe respetar el rango de fechas con from y to', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })

      // Crear un referido hoy
      await createReferido(admin.id, { nombre: 'R6', rut: '10000006-6', estado: 'PENDIENTE' })

      // Buscar con rango que incluya hoy
      const now = new Date()
      const from = new Date(now.getTime() - 1 * 24 * 3600 * 1000).toISOString()
      const to = new Date(now.getTime() + 1 * 24 * 3600 * 1000).toISOString()

      const res = await request(app)
        .get(`/api/kpis/overview?from=${from}&to=${to}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
      expect(res.body.range).toBeDefined()
    })

    it('debe retornar 0 si el rango no incluye referidos', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      // Crear un referido hoy
      await createReferido(admin.id, { nombre: 'R7', rut: '10000007-7', estado: 'PENDIENTE' })

      // Buscar en un rango pasado
      const from = '2020-01-01T00:00:00.000Z'
      const to = '2020-01-02T00:00:00.000Z'

      const res = await request(app)
        .get(`/api/kpis/overview?from=${from}&to=${to}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(0)
    })

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker1',
        correo: 'worker1@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/kpis/overview')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).get('/api/kpis/overview')
      expect(res.status).toBe(401)
    })
  })

  // ── GET /api/kpis/series ────────────────────────────────────────────────────
  // SKIP: series usa SQL raw (date_trunc) que no funciona en SQLite y causa timeout.
  // Estos tests requieren PostgreSQL real para ejecutarse.

  describe('GET /api/kpis/series', () => {
    it.skip('requiere PostgreSQL — usa date_trunc (raw SQL)', () => {})

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker2',
        correo: 'worker2@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/kpis/series?interval=day')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })
  })

  // ── GET /api/kpis/leadtime ──────────────────────────────────────────────────
  // SKIP: leadtime usa SQL raw (LEAD, EXTRACT) que no funciona en SQLite.

  describe('GET /api/kpis/leadtime', () => {
    it.skip('requiere PostgreSQL — usa LEAD/EXTRACT (raw SQL)', () => {})

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker3',
        correo: 'worker3@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/kpis/leadtime')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })
  })

  // ── GET /api/kpis/funnel ────────────────────────────────────────────────────
  // SKIP: funnel usa SQL raw que no funciona en SQLite.

  describe('GET /api/kpis/funnel', () => {
    it.skip('requiere PostgreSQL — usa raw SQL', () => {})

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker4',
        correo: 'worker4@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/kpis/funnel')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })
  })
})
