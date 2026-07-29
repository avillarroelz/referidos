// backend/tests/integration/auth.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken } = require('../helpers/auth')

describe('Auth API', () => {
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

  describe('POST /api/auth/register', () => {
    it('debe registrar un usuario nuevo', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'nuevo', correo: 'nuevo@test.com', password: 'TestSegura123!' })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.username).toBe('nuevo')
      expect(res.body.correo).toBe('nuevo@test.com')
      expect(res.body.message).toContain('creado exitosamente')
    })

    it('debe rechazar correo duplicado', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ username: 'user1', correo: 'dup@test.com', password: 'TestSegura123!' })

      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'user2', correo: 'dup@test.com', password: 'TestSegura123!' })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('ya está registrado')
    })

    it('debe rechazar correo inválido', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'user', correo: 'not-email', password: 'TestSegura123!' })

      expect(res.status).toBe(400)
    })

    it('debe rechazar password que no cumple la política (mín. 12)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'user', correo: 'valid@test.com', password: '123' })

      expect(res.status).toBe(400)
    })

    it('debe rechazar sin username', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ correo: 'valid@test.com', password: 'TestSegura123!' })

      expect(res.status).toBe(400)
    })

    it('debe asignar rol TRABAJADOR por defecto', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ username: 'worker', correo: 'worker@ecora.cl', password: 'TestSegura123!' })

      // Login to verify role
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'worker@ecora.cl', password: 'TestSegura123!' })

      expect(loginRes.body.user.roles).toContain('TRABAJADOR')
    })
  })

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await createTestUser(getModel, {
        username: 'testlogin',
        correo: 'login@test.com',
        password: 'TestSegura123!',
        roles: ['TRABAJADOR'],
      })
    })

    it('debe hacer login con credenciales válidas', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'login@test.com', password: 'TestSegura123!' })

      expect(res.status).toBe(200)
      // Los tokens viajan en cookies httpOnly, no en el body
      const cookies = res.headers['set-cookie'] || []
      expect(cookies.some(c => c.startsWith('__access_token='))).toBe(true)
      expect(cookies.some(c => c.startsWith('__refresh_token='))).toBe(true)
      expect(res.body.user).toBeDefined()
      expect(res.body.user.correo).toBe('login@test.com')
      expect(res.body.user.roles).toContain('TRABAJADOR')
    })

    it('debe rechazar correo incorrecto', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'wrong@test.com', password: 'TestSegura123!' })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Credenciales inválidas')
    })

    it('debe rechazar password incorrecto', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'login@test.com', password: 'WrongPass12345' })

      expect(res.status).toBe(401)
      expect(res.body.error).toContain('Credenciales inválidas')
    })

    it('debe rechazar correo inválido', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'not-email', password: 'TestSegura123!' })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/auth/refresh', () => {
    it('debe renovar el access token con refresh token válido (cookie)', async () => {
      await createTestUser(getModel, {
        username: 'refreshuser',
        correo: 'refresh@test.com',
        password: 'TestSegura123!',
        roles: ['TRABAJADOR'],
      })

      // Login para obtener la cookie de refresh
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'refresh@test.com', password: 'TestSegura123!' })

      const cookies = loginRes.headers['set-cookie'] || []
      const refreshCookie = cookies.find(c => c.startsWith('__refresh_token='))
      expect(refreshCookie).toBeDefined()

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshCookie.split(';')[0])

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      const newCookies = res.headers['set-cookie'] || []
      expect(newCookies.some(c => c.startsWith('__access_token='))).toBe(true)
    })

    it('debe rechazar refresh token inválido', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', '__refresh_token=invalid-token')

      expect(res.status).toBe(401)
    })

    it('debe rechazar sin refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({})

      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/auth/me', () => {
    it('debe retornar datos del usuario autenticado', async () => {
      const user = await createTestUser(getModel, {
        username: 'meuser',
        correo: 'me@test.com',
        password: 'TestSegura123!',
        roles: ['RRHH'],
      })

      const token = getAuthToken(user)

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(user.id)
      expect(res.body.username).toBe('meuser')
      expect(res.body.correo).toBe('me@test.com')
      expect(res.body.roles).toContain('RRHH')
      expect(res.body.password).toBeUndefined()
    })

    it('debe retornar 401 sin token', async () => {
      const res = await request(app).get('/api/auth/me')
      expect(res.status).toBe(401)
    })
  })
})
