// backend/tests/integration/notificaciones.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Notificaciones API', () => {
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
  // Helper: crea notificaciones directamente en BD
  // ──────────────────────────────────────────────────────────────

  async function crearNotificaciones(userId, cantidad = 3, leidas = false) {
    const Notificacion = getModel('Notificacion')
    const items = []
    for (let i = 1; i <= cantidad; i++) {
      const notif = await Notificacion.create({
        destinatarioUserId: userId,
        tipo: 'cambio_estado',
        titulo: `Notificacion ${i}`,
        mensaje: `Mensaje de prueba ${i}`,
        leida: leidas,
      })
      items.push(notif)
    }
    return items
  }

  // ──────────────────────────────────────────────────────────────
  // GET /api/notificaciones
  // ──────────────────────────────────────────────────────────────

  describe('GET /api/notificaciones', () => {
    it('lista notificaciones del usuario autenticado (200)', async () => {
      const user = await createTestUser(getModel, {
        username: 'notif_user',
        correo: 'notif_user@test.com',
        roles: ['TRABAJADOR'],
      })

      await crearNotificaciones(user.id, 3)

      const res = await request(app)
        .get('/api/notificaciones')
        .set(authHeader(user))

      expect(res.status).toBe(200)
      expect(res.body.data).toBeDefined()
      expect(res.body.total).toBe(3)
      expect(res.body.page).toBeDefined()
      expect(res.body.limit).toBeDefined()
      expect(Array.isArray(res.body.data)).toBe(true)
      expect(res.body.data).toHaveLength(3)
    })

    it('401 sin autenticacion', async () => {
      const res = await request(app)
        .get('/api/notificaciones')

      expect(res.status).toBe(401)
    })

    it('no muestra notificaciones de otros usuarios', async () => {
      const user1 = await createTestUser(getModel, {
        username: 'notif_u1',
        correo: 'notif_u1@test.com',
        roles: ['TRABAJADOR'],
      })

      const user2 = await createTestUser(getModel, {
        username: 'notif_u2',
        correo: 'notif_u2@test.com',
        roles: ['TRABAJADOR'],
      })

      await crearNotificaciones(user1.id, 2)
      await crearNotificaciones(user2.id, 5)

      const res = await request(app)
        .get('/api/notificaciones')
        .set(authHeader(user1))

      expect(res.status).toBe(200)
      expect(res.body.total).toBe(2)
    })
  })

  // ──────────────────────────────────────────────────────────────
  // GET /api/notificaciones/count
  // ──────────────────────────────────────────────────────────────

  describe('GET /api/notificaciones/count', () => {
    it('retorna conteo de no leidas', async () => {
      const user = await createTestUser(getModel, {
        username: 'count_user',
        correo: 'count_user@test.com',
        roles: ['RRHH'],
      })

      // 3 no leidas + 2 leidas
      await crearNotificaciones(user.id, 3, false)
      await crearNotificaciones(user.id, 2, true)

      const res = await request(app)
        .get('/api/notificaciones/count')
        .set(authHeader(user))

      expect(res.status).toBe(200)
      expect(res.body.count).toBe(3)
    })

    it('401 sin autenticacion', async () => {
      const res = await request(app)
        .get('/api/notificaciones/count')

      expect(res.status).toBe(401)
    })
  })

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/notificaciones/:id
  // ──────────────────────────────────────────────────────────────

  describe('PATCH /api/notificaciones/:id', () => {
    it('marca una notificacion como leida', async () => {
      const user = await createTestUser(getModel, {
        username: 'mark_user',
        correo: 'mark_user@test.com',
        roles: ['TRABAJADOR'],
      })

      const [notif] = await crearNotificaciones(user.id, 1, false)

      const res = await request(app)
        .patch(`/api/notificaciones/${notif.id}`)
        .set(authHeader(user))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que realmente se marco como leida
      const Notificacion = getModel('Notificacion')
      const updated = await Notificacion.findByPk(notif.id)
      expect(updated.leida).toBe(true)
    })

    it('401 sin autenticacion', async () => {
      const res = await request(app)
        .patch('/api/notificaciones/1')

      expect(res.status).toBe(401)
    })

    it('404 para notificacion que no pertenece al usuario', async () => {
      const user1 = await createTestUser(getModel, {
        username: 'owner_notif',
        correo: 'owner_notif@test.com',
        roles: ['TRABAJADOR'],
      })

      const user2 = await createTestUser(getModel, {
        username: 'other_notif',
        correo: 'other_notif@test.com',
        roles: ['TRABAJADOR'],
      })

      const [notif] = await crearNotificaciones(user1.id, 1, false)

      // user2 intenta marcar notificacion de user1
      const res = await request(app)
        .patch(`/api/notificaciones/${notif.id}`)
        .set(authHeader(user2))

      expect(res.status).toBe(404)
    })
  })

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/notificaciones/leer-todas
  // ──────────────────────────────────────────────────────────────

  describe('PATCH /api/notificaciones/leer-todas', () => {
    it('marca todas las notificaciones como leidas', async () => {
      const user = await createTestUser(getModel, {
        username: 'all_read',
        correo: 'all_read@test.com',
        roles: ['RRHH'],
      })

      await crearNotificaciones(user.id, 5, false)

      const res = await request(app)
        .patch('/api/notificaciones/leer-todas')
        .set(authHeader(user))

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      // Verificar que todas estan leidas
      const countRes = await request(app)
        .get('/api/notificaciones/count')
        .set(authHeader(user))

      expect(countRes.body.count).toBe(0)
    })

    it('401 sin autenticacion', async () => {
      const res = await request(app)
        .patch('/api/notificaciones/leer-todas')

      expect(res.status).toBe(401)
    })
  })
})
