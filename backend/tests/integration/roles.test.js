// backend/tests/integration/roles.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Roles API', () => {
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

  // ── GET /api/roles ──────────────────────────────────────────────────────────

  describe('GET /api/roles', () => {
    it('debe listar roles cuando el usuario es ADMIN', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin1',
        correo: 'admin@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .get('/api/roles')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBeGreaterThanOrEqual(4)
      const nombres = res.body.map((r) => r.nombre)
      expect(nombres).toContain('ADMIN')
      expect(nombres).toContain('RRHH')
      expect(nombres).toContain('TRABAJADOR')
      expect(nombres).toContain('ADC')
    })

    it('debe listar roles cuando el usuario es RRHH', async () => {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh1',
        correo: 'rrhh@test.com',
        roles: ['RRHH'],
      })

      const res = await request(app)
        .get('/api/roles')
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })

    it('debe retornar 403 cuando el usuario es TRABAJADOR', async () => {
      const worker = await createTestUser(getModel, {
        username: 'worker1',
        correo: 'worker@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/roles')
        .set(authHeader(worker))

      expect(res.status).toBe(403)
    })
  })

  // ── GET /api/roles/usuarios ─────────────────────────────────────────────────

  describe('GET /api/roles/usuarios', () => {
    it('debe listar usuarios con sus roles (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin2',
        correo: 'admin2@test.com',
        roles: ['ADMIN'],
      })
      // Crear un segundo usuario para validar la lista
      await createTestUser(getModel, {
        username: 'extra',
        correo: 'extra@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get('/api/roles/usuarios')
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body.length).toBeGreaterThanOrEqual(2)

      // Cada usuario debe tener el campo roles y NO el campo password
      res.body.forEach((u) => {
        expect(u).toHaveProperty('roles')
        expect(u.password).toBeUndefined()
      })
    })
  })

  // ── POST /api/roles ─────────────────────────────────────────────────────────

  describe('POST /api/roles', () => {
    it('debe crear un rol nuevo (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin3',
        correo: 'admin3@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/roles')
        .set(authHeader(admin))
        .send({ nombre: 'SUPERVISOR', descripcion: 'Rol supervisor' })

      expect(res.status).toBe(201)
      expect(res.body.nombre).toBe('SUPERVISOR')
      expect(res.body.descripcion).toBe('Rol supervisor')
      expect(res.body.id).toBeDefined()
    })

    it('debe retornar 409 si el nombre ya existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin4',
        correo: 'admin4@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/roles')
        .set(authHeader(admin))
        .send({ nombre: 'ADMIN', descripcion: 'Duplicado' })

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
        .post('/api/roles')
        .set(authHeader(admin))
        .send({ descripcion: 'Sin nombre' })

      expect(res.status).toBe(400)
    })
  })

  // ── DELETE /api/roles/:id ───────────────────────────────────────────────────

  describe('DELETE /api/roles/:id', () => {
    it('debe eliminar un rol (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin6',
        correo: 'admin6@test.com',
        roles: ['ADMIN'],
      })

      // Crear un rol que luego eliminaremos
      const Rol = getModel('Rol')
      const nuevoRol = await Rol.create({ nombre: 'TEMPORAL', descripcion: 'Para eliminar' })

      const res = await request(app)
        .delete(`/api/roles/${nuevoRol.id}`)
        .set(authHeader(admin))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que ya no existe
      const found = await Rol.findByPk(nuevoRol.id)
      expect(found).toBeNull()
    })

    it('debe retornar 404 si el rol no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin7',
        correo: 'admin7@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .delete('/api/roles/99999')
        .set(authHeader(admin))

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/roles/asignar/:usuarioId ──────────────────────────────────────

  describe('POST /api/roles/asignar/:usuarioId', () => {
    it('debe asignar un rol a un usuario (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin8',
        correo: 'admin8@test.com',
        roles: ['ADMIN'],
      })
      const target = await createTestUser(getModel, {
        username: 'target1',
        correo: 'target1@test.com',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .post(`/api/roles/asignar/${target.id}`)
        .set(authHeader(admin))
        .send({ rolNombre: 'RRHH' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que se asigno
      const Rol = getModel('Rol')
      const Usuario = getModel('Usuario')
      const updated = await Usuario.findByPk(target.id, {
        include: [{ model: Rol, as: 'roles' }],
      })
      const nombres = updated.roles.map((r) => r.nombre)
      expect(nombres).toContain('RRHH')
    })

    it('debe retornar 404 si el usuario no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin9',
        correo: 'admin9@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/roles/asignar/99999')
        .set(authHeader(admin))
        .send({ rolNombre: 'RRHH' })

      expect(res.status).toBe(404)
    })
  })

  // ── POST /api/roles/quitar/:usuarioId ───────────────────────────────────────

  describe('POST /api/roles/quitar/:usuarioId', () => {
    it('debe quitar un rol a un usuario (ADMIN)', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin10',
        correo: 'admin10@test.com',
        roles: ['ADMIN'],
      })
      const target = await createTestUser(getModel, {
        username: 'target2',
        correo: 'target2@test.com',
        roles: ['TRABAJADOR', 'RRHH'],
      })

      const res = await request(app)
        .post(`/api/roles/quitar/${target.id}`)
        .set(authHeader(admin))
        .send({ rolNombre: 'RRHH' })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que se quito
      const Rol = getModel('Rol')
      const Usuario = getModel('Usuario')
      const updated = await Usuario.findByPk(target.id, {
        include: [{ model: Rol, as: 'roles' }],
      })
      const nombres = updated.roles.map((r) => r.nombre)
      expect(nombres).not.toContain('RRHH')
      expect(nombres).toContain('TRABAJADOR')
    })

    it('debe retornar 404 si el usuario no existe', async () => {
      const admin = await createTestUser(getModel, {
        username: 'admin11',
        correo: 'admin11@test.com',
        roles: ['ADMIN'],
      })

      const res = await request(app)
        .post('/api/roles/quitar/99999')
        .set(authHeader(admin))
        .send({ rolNombre: 'RRHH' })

      expect(res.status).toBe(404)
    })
  })
})
