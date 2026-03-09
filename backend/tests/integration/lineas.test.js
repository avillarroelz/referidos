// backend/tests/integration/lineas.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Lineas de Negocio API', () => {
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

  // ── GET /api/lineas ─────────────────────────────────────────────────────────

  describe('GET /api/lineas', () => {
    it('debe listar lineas de negocio (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin1@test.com',
        roles: ['ADMIN'],
      })

      const Linea = getModel('LineaNegocio')
      await Linea.create({ nombre: 'Linea Alpha', descripcion: 'Primera linea' })
      await Linea.create({ nombre: 'Linea Beta', descripcion: 'Segunda linea' })

      const res = await request(app)
        .get('/api/lineas')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(2)
      expect(res.body[0].nombre).toBe('Linea Alpha')
      expect(res.body[1].nombre).toBe('Linea Beta')
    })

    it('debe listar lineas de negocio (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh1@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .get('/api/lineas')
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker1',
        correo: 'worker1@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/lineas')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).get('/api/lineas')
      expect(res.status).toBe(401)
    })
  })

  // ── POST /api/lineas ────────────────────────────────────────────────────────

  describe('POST /api/lineas', () => {
    it('debe crear una linea de negocio (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/lineas')
        .set(authHeader(admin))
        .send({ nombre: 'Linea Gamma', descripcion: 'Nueva linea' })

      expect(res.status).toBe(201)
      expect(res.body.nombre).toBe('Linea Gamma')
      expect(res.body.descripcion).toBe('Nueva linea')
      expect(res.body.id).toBeDefined()
    })

    it('debe retornar 409 si el nombre ya existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      const Linea = getModel('LineaNegocio')
      await Linea.create({ nombre: 'Duplicada', descripcion: 'Ya existe' })

      const res = await request(app)
        .post('/api/lineas')
        .set(authHeader(admin))
        .send({ nombre: 'Duplicada', descripcion: 'Intento duplicado' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBeDefined()
    })

    it('debe retornar 400 si falta el nombre', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin4',
        correo: 'admin4@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/lineas')
        .set(authHeader(admin))
        .send({ descripcion: 'Sin nombre' })

      expect(res.status).toBe(400)
    })

    it('debe retornar 403 para RRHH', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh2',
        correo: 'rrhh2@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .post('/api/lineas')
        .set(authHeader(rrhh))
        .send({ nombre: 'Prohibida', descripcion: 'No deberia' })

      expect(res.status).toBe(403)
    })
  })

  // ── PUT /api/lineas/:id ─────────────────────────────────────────────────────

  describe('PUT /api/lineas/:id', () => {
    it('debe actualizar una linea (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin5',
        correo: 'admin5@test.com',
        roles: ['ADMIN'],
      })

      const Linea = getModel('LineaNegocio')
      const linea = await Linea.create({ nombre: 'Original', descripcion: 'Antes' })

      const res = await request(app)
        .put(`/api/lineas/${linea.id}`)
        .set(authHeader(admin))
        .send({ nombre: 'Modificada', descripcion: 'Despues' })

      expect(res.status).toBe(200)
      expect(res.body.nombre).toBe('Modificada')
      expect(res.body.descripcion).toBe('Despues')
    })

    it('debe retornar 404 si no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin6',
        correo: 'admin6@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .put('/api/lineas/99999')
        .set(authHeader(admin))
        .send({ nombre: 'Fantasma' })

      expect(res.status).toBe(404)
    })
  })

  // ── DELETE /api/lineas/:id ──────────────────────────────────────────────────

  describe('DELETE /api/lineas/:id', () => {
    it('debe eliminar una linea (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin7',
        correo: 'admin7@test.com',
        roles: ['ADMIN'],
      })

      const Linea = getModel('LineaNegocio')
      const linea = await Linea.create({ nombre: 'Eliminable', descripcion: 'Bye' })

      const res = await request(app)
        .delete(`/api/lineas/${linea.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const found = await Linea.findByPk(linea.id)
      expect(found).toBeNull()
    })

    it('debe retornar 404 si no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin8',
        correo: 'admin8@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .delete('/api/lineas/99999')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })
  })
})
