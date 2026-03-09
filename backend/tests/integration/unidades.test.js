// backend/tests/integration/unidades.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Unidades de Negocio API', () => {
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

  // ── GET /api/unidades ───────────────────────────────────────────────────────

  describe('GET /api/unidades', () => {
    it('debe listar unidades cuando el usuario es ADMIN', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin1@test.com',
        roles: ['ADMIN'],
      })

      // Crear una unidad
      const Unidad = getModel('UnidadNegocio')
      await Unidad.create({ nombre: 'Unidad A', descripcion: 'Primera unidad', estado: true })

      const res = await request(app)
        .get('/api/unidades')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBe(1)
      expect(res.body[0].nombre).toBe('Unidad A')
    })

    it('debe listar unidades cuando el usuario es RRHH', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh1@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .get('/api/unidades')
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })

    it('debe retornar 401 sin autenticacion', async () => {
      const res = await request(app).get('/api/unidades')

      expect(res.status).toBe(401)
    })
  })

  // ── POST /api/unidades ──────────────────────────────────────────────────────

  describe('POST /api/unidades', () => {
    it('debe crear una unidad (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/unidades')
        .set(authHeader(admin))
        .send({ nombre: 'Unidad B', descripcion: 'Segunda unidad', estado: true })

      expect(res.status).toBe(201)
      expect(res.body.nombre).toBe('Unidad B')
      expect(res.body.descripcion).toBe('Segunda unidad')
      expect(res.body.id).toBeDefined()
    })

    it('debe crear una unidad con lineaNegocioId', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      // Crear linea de negocio primero
      const Linea = getModel('LineaNegocio')
      const linea = await Linea.create({ nombre: 'Linea X', descripcion: 'Test' })

      const res = await request(app)
        .post('/api/unidades')
        .set(authHeader(admin))
        .send({ nombre: 'Unidad C', descripcion: 'Con linea', estado: true, lineaNegocioId: linea.id })

      expect(res.status).toBe(201)
      expect(res.body.lineaNegocioId).toBe(linea.id)
    })

    it('debe retornar 409 si el nombre ya existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin4',
        correo: 'admin4@test.com',
        roles: ['ADMIN'],
      })

      const Unidad = getModel('UnidadNegocio')
      await Unidad.create({ nombre: 'Duplicada', descripcion: 'Ya existe', estado: true })

      const res = await request(app)
        .post('/api/unidades')
        .set(authHeader(admin))
        .send({ nombre: 'Duplicada', descripcion: 'Intento duplicado' })

      expect(res.status).toBe(409)
      expect(res.body.error).toBeDefined()
    })

    it('debe retornar 400 si falta el nombre', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin5',
        correo: 'admin5@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/unidades')
        .set(authHeader(admin))
        .send({ descripcion: 'Sin nombre' })

      expect(res.status).toBe(400)
    })
  })

  // ── PUT /api/unidades/:id ───────────────────────────────────────────────────

  describe('PUT /api/unidades/:id', () => {
    it('debe actualizar una unidad (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin6',
        correo: 'admin6@test.com',
        roles: ['ADMIN'],
      })

      const Unidad = getModel('UnidadNegocio')
      const unidad = await Unidad.create({ nombre: 'Original', descripcion: 'Antes', estado: true })

      const res = await request(app)
        .put(`/api/unidades/${unidad.id}`)
        .set(authHeader(admin))
        .send({ nombre: 'Actualizada', descripcion: 'Despues', estado: false })

      expect(res.status).toBe(200)
      expect(res.body.nombre).toBe('Actualizada')
      expect(res.body.descripcion).toBe('Despues')
    })

    it('debe retornar 404 si la unidad no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin7',
        correo: 'admin7@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .put('/api/unidades/99999')
        .set(authHeader(admin))
        .send({ nombre: 'Inexistente' })

      expect(res.status).toBe(404)
    })
  })

  // ── DELETE /api/unidades/:id ────────────────────────────────────────────────

  describe('DELETE /api/unidades/:id', () => {
    it('debe eliminar una unidad (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin8',
        correo: 'admin8@test.com',
        roles: ['ADMIN'],
      })

      const Unidad = getModel('UnidadNegocio')
      const unidad = await Unidad.create({ nombre: 'Para borrar', estado: true })

      const res = await request(app)
        .delete(`/api/unidades/${unidad.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const found = await Unidad.findByPk(unidad.id)
      expect(found).toBeNull()
    })

    it('debe retornar 404 si la unidad no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin9',
        correo: 'admin9@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .delete('/api/unidades/99999')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/unidades/asignar/:usuarioId ───────────────────────────────────

  describe('POST /api/unidades/asignar/:usuarioId', () => {
    it('debe asignar una unidad a un usuario (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin10',
        correo: 'admin10@test.com',
        roles: ['ADMIN'],
      })
      const target = await createTestUser(getModel, {
        username: 'target1',
        correo: 'target1@test.com',
        roles: ['TRABAJADOR'],
      })

      const Unidad = getModel('UnidadNegocio')
      const unidad = await Unidad.create({ nombre: 'Asignable', estado: true })

      const res = await request(app)
        .post(`/api/unidades/asignar/${target.id}`)
        .set(authHeader(admin))
        .send({ unidadNegocioId: unidad.id })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('debe asignar una unidad a un usuario (RRHH)', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh2',
        correo: 'rrhh2@test.com',
        roles: ['RRHH'],
      })
      const target = await createTestUser(getModel, {
        username: 'target2',
        correo: 'target2@test.com',
        roles: ['TRABAJADOR'],
      })

      const Unidad = getModel('UnidadNegocio')
      const unidad = await Unidad.create({ nombre: 'Asignable 2', estado: true })

      const res = await request(app)
        .post(`/api/unidades/asignar/${target.id}`)
        .set(authHeader(rrhh))
        .send({ unidadNegocioId: unidad.id })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('debe retornar 404 si el usuario o unidad no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin11',
        correo: 'admin11@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/unidades/asignar/99999')
        .set(authHeader(admin))
        .send({ unidadNegocioId: 99999 })

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/unidades/quitar/:usuarioId ────────────────────────────────────

  describe('POST /api/unidades/quitar/:usuarioId', () => {
    it('debe quitar una unidad a un usuario (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin12',
        correo: 'admin12@test.com',
        roles: ['ADMIN'],
      })
      const target = await createTestUser(getModel, {
        username: 'target3',
        correo: 'target3@test.com',
        roles: ['TRABAJADOR'],
      })

      const Unidad = getModel('UnidadNegocio')
      const unidad = await Unidad.create({ nombre: 'Quitable', estado: true })

      // Asignar primero
      const Usuario = getModel('Usuario')
      const user = await Usuario.findByPk(target.id)
      await user.addUnidadNegocio(unidad)

      const res = await request(app)
        .post(`/api/unidades/quitar/${target.id}`)
        .set(authHeader(admin))
        .send({ unidadNegocioId: unidad.id })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
    })

    it('debe retornar 404 si el usuario o unidad no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin13',
        correo: 'admin13@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/unidades/quitar/99999')
        .set(authHeader(admin))
        .send({ unidadNegocioId: 99999 })

      expect(res.status).toBe(404)
    })
  })
})
