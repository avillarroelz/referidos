// backend/tests/integration/referidos-states.test.js
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, getAuthToken, authHeader } = require('../helpers/auth')

describe('Referidos State Transitions API', () => {
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
  // Helper: crea un referido en PENDIENTE via API
  // ──────────────────────────────────────────────────────────────

  async function crearReferido(user, overrides = {}) {
    const res = await request(app)
      .post('/api/referidos')
      .set(authHeader(user))
      .send({
        nombre: 'Test Referido',
        email: 'referido@test.com',
        ...overrides,
      })
    return res.body
  }

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/referidos/:id/estado
  // ──────────────────────────────────────────────────────────────

  describe('PATCH /api/referidos/:id/estado', () => {
    it('RRHH puede cambiar PENDIENTE a EN_REVISION', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_state',
        correo: 'rrhh_state@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferido(rrhhUser)

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(rrhhUser))
        .send({
          nuevoEstado: 'EN_REVISION',
          comentario: 'Iniciando revision',
        })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.id).toBe(ref.id)
      expect(res.body.estado).toBe('EN_REVISION')
    })

    it('rechaza transicion invalida PENDIENTE a APROBADO (400)', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_invalid',
        correo: 'rrhh_invalid@test.com',
        roles: ['RRHH'],
      })

      const ref = await crearReferido(rrhhUser)

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(rrhhUser))
        .send({
          nuevoEstado: 'APROBADO',
          comentario: 'Intentando saltar pasos',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('inválida')
    })

    it('TRABAJADOR no puede cambiar estado (403)', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_creator',
        correo: 'rrhh_creator@test.com',
        roles: ['RRHH'],
      })

      const workerUser = await createTestUser(getModel, {
        username: 'worker_state',
        correo: 'worker_state@test.com',
        roles: ['TRABAJADOR'],
      })

      const ref = await crearReferido(rrhhUser)

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(workerUser))
        .send({
          nuevoEstado: 'EN_REVISION',
          comentario: 'Intento no autorizado',
        })

      expect(res.status).toBe(403)
    })
  })

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/referidos/:id/asignar-adc
  // ──────────────────────────────────────────────────────────────

  describe('PATCH /api/referidos/:id/asignar-adc', () => {
    it('RRHH puede asignar un usuario ADC y recibe slaDeadline', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_adc',
        correo: 'rrhh_adc@test.com',
        roles: ['RRHH'],
      })

      const adcUser = await createTestUser(getModel, {
        username: 'adc_user',
        correo: 'adc_user@test.com',
        roles: ['ADC'],
      })

      const ref = await crearReferido(rrhhUser)

      // Primero cambiar a EN_REVISION para que la asignacion transite el estado
      await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(rrhhUser))
        .send({ nuevoEstado: 'EN_REVISION', comentario: 'Revisando' })

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/asignar-adc`)
        .set(authHeader(rrhhUser))
        .send({ adcUserId: adcUser.id })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.asignadoADCUserId).toBe(adcUser.id)
      expect(res.body.slaDeadline).toBeDefined()
      expect(res.body.estado).toBe('ENVIADO_ADC')
    })

    it('rechaza asignar usuario sin rol ADC (400)', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_reject',
        correo: 'rrhh_reject@test.com',
        roles: ['RRHH'],
      })

      const workerUser = await createTestUser(getModel, {
        username: 'worker_no_adc',
        correo: 'worker_no_adc@test.com',
        roles: ['TRABAJADOR'],
      })

      const ref = await crearReferido(rrhhUser)

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/asignar-adc`)
        .set(authHeader(rrhhUser))
        .send({ adcUserId: workerUser.id })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('ADC')
    })
  })

  // ──────────────────────────────────────────────────────────────
  // PATCH /api/referidos/:id/dictamen
  // ──────────────────────────────────────────────────────────────

  describe('PATCH /api/referidos/:id/dictamen', () => {
    let rrhhUser, adcUser, refId

    beforeEach(async () => {
      rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_dict',
        correo: 'rrhh_dict@test.com',
        roles: ['RRHH'],
      })

      adcUser = await createTestUser(getModel, {
        username: 'adc_dict',
        correo: 'adc_dict@test.com',
        roles: ['ADC'],
      })

      // Crear referido, cambiar a EN_REVISION, asignar ADC => ENVIADO_ADC
      const ref = await crearReferido(rrhhUser)
      refId = ref.id

      await request(app)
        .patch(`/api/referidos/${refId}/estado`)
        .set(authHeader(rrhhUser))
        .send({ nuevoEstado: 'EN_REVISION', comentario: 'Revisando' })

      await request(app)
        .patch(`/api/referidos/${refId}/asignar-adc`)
        .set(authHeader(rrhhUser))
        .send({ adcUserId: adcUser.id })
    })

    it('ADC asignado puede dictaminar CUMPLE', async () => {
      const res = await request(app)
        .patch(`/api/referidos/${refId}/dictamen`)
        .set(authHeader(adcUser))
        .send({
          dictamen: 'CUMPLE',
          comentario: 'Todo en orden',
        })

      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)
      expect(res.body.dictamen).toBe('CUMPLE')
      expect(res.body.estado).toBe('VALIDADO_ADC')
    })

    it('ADC no asignado no puede dictaminar (403)', async () => {
      const otherAdc = await createTestUser(getModel, {
        username: 'adc_other',
        correo: 'adc_other@test.com',
        roles: ['ADC'],
      })

      const res = await request(app)
        .patch(`/api/referidos/${refId}/dictamen`)
        .set(authHeader(otherAdc))
        .send({
          dictamen: 'CUMPLE',
          comentario: 'Intento desde otro ADC',
        })

      expect(res.status).toBe(403)
      expect(res.body.error).toContain('ADC asignado')
    })
  })

  // ──────────────────────────────────────────────────────────────
  // Terminal states: APROBADO / RECHAZADO no pueden transicionar
  // ──────────────────────────────────────────────────────────────

  describe('Estados terminales', () => {
    it('referido en APROBADO no puede transicionar', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_term',
        correo: 'rrhh_term@test.com',
        roles: ['RRHH'],
      })

      const Referido = getModel('Referido')
      const ref = await Referido.create({
        nombre: 'Aprobado Test',
        estado: 'APROBADO',
        creadoPorUserId: rrhhUser.id,
      })

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(rrhhUser))
        .send({
          nuevoEstado: 'EN_REVISION',
          comentario: 'Intentando reabrir',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('inválida')
    })

    it('referido en RECHAZADO no puede transicionar', async () => {
      const rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_rej',
        correo: 'rrhh_rej@test.com',
        roles: ['RRHH'],
      })

      const Referido = getModel('Referido')
      const ref = await Referido.create({
        nombre: 'Rechazado Test',
        estado: 'RECHAZADO',
        creadoPorUserId: rrhhUser.id,
      })

      const res = await request(app)
        .patch(`/api/referidos/${ref.id}/estado`)
        .set(authHeader(rrhhUser))
        .send({
          nuevoEstado: 'PENDIENTE',
          comentario: 'Intentando reabrir',
        })

      expect(res.status).toBe(400)
      expect(res.body.error).toContain('inválida')
    })
  })
})
