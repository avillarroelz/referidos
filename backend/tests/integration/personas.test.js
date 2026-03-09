// backend/tests/integration/personas.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Personas API', () => {
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

  // ── GET /api/personas ───────────────────────────────────────────────────────

  describe('GET /api/personas', () => {
    it('debe listar personas (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin1@test.com',
        roles: ['ADMIN'],
      })

      const Persona = getModel('Persona')
      await Persona.create({ nombres: 'Juan', apellidos: 'Perez', rut: '12345678-9', telefono: '+56912345678', email: 'juan@test.com' })
      await Persona.create({ nombres: 'Maria', apellidos: 'Lopez', rut: '98765432-1', telefono: '+56987654321', email: 'maria@test.com' })

      const res = await request(app)
        .get('/api/personas')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(2)
    })

    it('debe listar personas (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh1@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .get('/api/personas')
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).get('/api/personas')
      expect(res.status).toBe(401)
    })

    it('debe retornar 403 para TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker1',
        correo: 'worker1@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/personas')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })
  })

  // ── GET /api/personas/:id ───────────────────────────────────────────────────

  describe('GET /api/personas/:id', () => {
    it('debe obtener una persona por ID', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })

      const Persona = getModel('Persona')
      const persona = await Persona.create({
        nombres: 'Carlos',
        apellidos: 'Garcia',
        rut: '11111111-1',
        telefono: '+56911111111',
        email: 'carlos@test.com',
      })

      const res = await request(app)
        .get(`/api/personas/${persona.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.nombres).toBe('Carlos')
      expect(res.body.apellidos).toBe('Garcia')
      expect(res.body.rut).toBe('11111111-1')
      expect(res.body.email).toBe('carlos@test.com')
    })

    it('debe retornar 404 si la persona no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .get('/api/personas/99999')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/personas ──────────────────────────────────────────────────────

  describe('POST /api/personas', () => {
    it('debe crear una persona (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin4',
        correo: 'admin4@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/personas')
        .set(authHeader(admin))
        .send({
          nombres: 'Pedro',
          apellidos: 'Martinez',
          rut: '22222222-2',
          telefono: '+56922222222',
          email: 'pedro@test.com',
        })

      expect(res.status).toBe(201)
      expect(res.body.nombres).toBe('Pedro')
      expect(res.body.apellidos).toBe('Martinez')
      expect(res.body.rut).toBe('22222222-2')
      expect(res.body.id).toBeDefined()
    })

    it('debe crear una persona (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh2',
        correo: 'rrhh2@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .post('/api/personas')
        .set(authHeader(rrhh))
        .send({
          nombres: 'Ana',
          apellidos: 'Soto',
          rut: '33333333-3',
          telefono: '+56933333333',
          email: 'ana@test.com',
        })

      expect(res.status).toBe(201)
      expect(res.body.nombres).toBe('Ana')
    })

    it('debe retornar 400 si falta nombres', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin5',
        correo: 'admin5@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/personas')
        .set(authHeader(admin))
        .send({ apellidos: 'Solo apellido' })

      expect(res.status).toBe(400)
    })

    it('debe retornar 400 si falta apellidos', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin6',
        correo: 'admin6@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/personas')
        .set(authHeader(admin))
        .send({ nombres: 'Solo nombre' })

      expect(res.status).toBe(400)
    })

    it('debe crear persona con campos minimos (solo nombres y apellidos)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin7',
        correo: 'admin7@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/personas')
        .set(authHeader(admin))
        .send({ nombres: 'Minimo', apellidos: 'Requerido' })

      expect(res.status).toBe(201)
      expect(res.body.nombres).toBe('Minimo')
      expect(res.body.apellidos).toBe('Requerido')
    })
  })

  // ── PUT /api/personas/:id ───────────────────────────────────────────────────

  describe('PUT /api/personas/:id', () => {
    it('debe actualizar una persona', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin8',
        correo: 'admin8@test.com',
        roles: ['ADMIN'],
      })

      const Persona = getModel('Persona')
      const persona = await Persona.create({
        nombres: 'Antes',
        apellidos: 'Cambio',
        rut: '44444444-4',
      })

      const res = await request(app)
        .put(`/api/personas/${persona.id}`)
        .set(authHeader(admin))
        .send({
          nombres: 'Despues',
          apellidos: 'Actualizado',
          telefono: '+56944444444',
        })

      expect(res.status).toBe(200)
      expect(res.body.nombres).toBe('Despues')
      expect(res.body.apellidos).toBe('Actualizado')
    })

    it('debe retornar 404 si la persona no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin9',
        correo: 'admin9@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .put('/api/personas/99999')
        .set(authHeader(admin))
        .send({ nombres: 'Fantasma', apellidos: 'Inexistente' })

      expect(res.status).toBe(404)
    })
  })

  // ── DELETE /api/personas/:id ────────────────────────────────────────────────

  describe('DELETE /api/personas/:id', () => {
    it('debe eliminar una persona (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin10',
        correo: 'admin10@test.com',
        roles: ['ADMIN'],
      })

      const Persona = getModel('Persona')
      const persona = await Persona.create({
        nombres: 'Eliminar',
        apellidos: 'Este',
        rut: '55555555-5',
      })

      const res = await request(app)
        .delete(`/api/personas/${persona.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const found = await Persona.findByPk(persona.id)
      expect(found).toBeNull()
    })

    it('debe retornar 404 si la persona no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin11',
        correo: 'admin11@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .delete('/api/personas/99999')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })

    it('debe retornar 403 si RRHH intenta eliminar', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh3',
        correo: 'rrhh3@test.com',
        roles: ['RRHH'],
      })

      const Persona = getModel('Persona')
      const persona = await Persona.create({
        nombres: 'No borrar',
        apellidos: 'Protegido',
        rut: '66666666-6',
      })

      const res = await request(app)
        .delete(`/api/personas/${persona.id}`)
        .set(authHeader(rrhh))

      expect(res.status).toBe(403)
    })
  })
})
