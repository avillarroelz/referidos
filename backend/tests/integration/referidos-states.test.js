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

      // ENVIADO_ADC solo se alcanza desde APROBADO_JEFE (lib/estados.js)
      await getModel('Referido').update({ estado: 'APROBADO_JEFE' }, { where: { id: ref.id } })

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

      // Crear referido, dejarlo en APROBADO_JEFE, asignar ADC => ENVIADO_ADC
      const ref = await crearReferido(rrhhUser)
      refId = ref.id

      await getModel('Referido').update({ estado: 'APROBADO_JEFE' }, { where: { id: refId } })

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
  // Flujo ADC segun la maquina de estados (lib/estados.js):
  // ENVIADO_ADC solo desde APROBADO_JEFE; VALIDADO/RECHAZADO_ADC solo por dictamen
  // ──────────────────────────────────────────────────────────────

  describe('Flujo ADC (APROBADO_JEFE -> ENVIADO_ADC -> dictamen)', () => {
    let rrhhUser, adcUser

    beforeEach(async () => {
      rrhhUser = await createTestUser(getModel, {
        username: 'rrhh_flujo', correo: 'rrhh_flujo@test.com', roles: ['RRHH'],
      })
      adcUser = await createTestUser(getModel, {
        username: 'adc_flujo', correo: 'adc_flujo@test.com', roles: ['ADC'],
      })
    })

    async function referidoEn(estado) {
      const ref = await crearReferido(rrhhUser)
      await getModel('Referido').update({ estado }, { where: { id: ref.id } })
      return ref.id
    }

    it('APROBADO_JEFE + asignar pasa a ENVIADO_ADC (SLA, historial) y el ADC puede dictaminar', async () => {
      const id = await referidoEn('APROBADO_JEFE')

      const asignar = await request(app)
        .patch(`/api/referidos/${id}/asignar-adc`)
        .set(authHeader(rrhhUser))
        .send({ adcUserId: adcUser.id })

      expect(asignar.status).toBe(200)
      expect(asignar.body.estado).toBe('ENVIADO_ADC')

      const ref = await getModel('Referido').findByPk(id)
      expect(ref.estado).toBe('ENVIADO_ADC')
      expect(ref.fechaEnvioADC).not.toBeNull()
      expect(ref.slaDeadline).not.toBeNull()
      const hist = await getModel('EstadoHistorial').findOne({ where: { referidoId: id, hacia: 'ENVIADO_ADC' } })
      expect(hist.desde).toBe('APROBADO_JEFE')

      const dictamen = await request(app)
        .patch(`/api/referidos/${id}/dictamen`)
        .set(authHeader(adcUser))
        .send({ dictamen: 'CUMPLE' })

      expect(dictamen.status).toBe(200)
      expect(dictamen.body.estado).toBe('VALIDADO_ADC')
    })

    it('EN_REVISION + asignar responde 409 y no modifica nada', async () => {
      const id = await referidoEn('EN_REVISION')

      const res = await request(app)
        .patch(`/api/referidos/${id}/asignar-adc`)
        .set(authHeader(rrhhUser))
        .send({ adcUserId: adcUser.id })

      expect(res.status).toBe(409)
      expect(res.body.error).toContain('APROBADO_JEFE')

      const ref = await getModel('Referido').findByPk(id)
      expect(ref.estado).toBe('EN_REVISION')
      expect(ref.asignadoADCUserId).toBeNull()
      expect(ref.fechaEnvioADC).toBeNull()
      expect(ref.slaDeadline).toBeNull()
      // La creacion ya deja una fila de historial; lo que no debe existir es la de ENVIADO_ADC
      expect(await getModel('EstadoHistorial').count({ where: { referidoId: id, hacia: 'ENVIADO_ADC' } })).toBe(0)
    })

    it.each(['VALIDADO_ADC', 'RECHAZADO_ADC', 'ENVIADO_ADC'])(
      'el cambio manual a %s se rechaza y el estado queda intacto',
      async (destino) => {
        // Estado de origen desde el cual la maquina SI permitiria el salto,
        // para que el rechazo se deba a la regla manual y no a la transicion.
        const origen = destino === 'ENVIADO_ADC' ? 'APROBADO_JEFE' : 'ENVIADO_ADC'
        const id = await referidoEn(origen)

        const res = await request(app)
          .patch(`/api/referidos/${id}/estado`)
          .set(authHeader(rrhhUser))
          .send({ nuevoEstado: destino })

        expect(res.status).toBe(400)
        expect(res.body.error).toMatch(/Asignar Aprobador|dictamen/)
        expect((await getModel('Referido').findByPk(id)).estado).toBe(origen)
      },
    )
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
