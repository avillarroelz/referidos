// backend/tests/integration/referidos-acceso.test.js
// Dos guardas de control de acceso sobre referidos:
//
//   V8 — POST /api/referidos. La regla de negocio es que cualquier rol INTERNO
//   agrega referidos y EXTERNO no. Se prueba por EXCLUSION, no enumerando los
//   roles internos: hay un caso con un rol que hoy no existe en el sistema, que
//   debe poder crear. Ese caso falla si alguien implementa la guarda con una
//   lista blanca, que es justo lo que se quiere evitar — una whitelist se rompe
//   en silencio el dia que se agregue un rol nuevo.
//
//   V9 — GET /api/referidos/:id y /:id/historial. El postulante externo es dueño
//   de su propia postulacion y hoy recibe 403 al pedirla, porque ambos handlers
//   miran creadoPorUserId y asignadoADCUserId pero no postulanteUserId.
//   adjuntos.controller.js si lo contempla, asi que hoy el mismo usuario ve los
//   adjuntos de su postulacion y no puede ver la postulacion misma.
//
// En los casos de V9 el referido se crea con creadoPorUserId de un RRHH, de modo
// que la unica via de acceso posible para el postulante sea postulanteUserId.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

/** Roles que seedRoles() no siembra. findOrCreate los deja idempotentes. */
async function seedRolesExtra(getModel) {
  const Rol = getModel('Rol')
  for (const nombre of ['EXTERNO', 'JefeRRHH', 'ROL_FUTURO_NO_EXISTENTE']) {
    await Rol.findOrCreate({
      where: { nombre },
      defaults: { nombre, descripcion: `Rol ${nombre} para testing` },
    })
  }
}

const REFERIDO_VALIDO = {
  nombre: 'Candidato De Prueba',
  email: 'candidato@test.com',
  telefono: '+56912345678',
  rut: '11111111-1',
  cargoPostulado: 'Analista',
}

describe('Control de acceso sobre referidos', () => {
  let getModel

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
    await seedRolesExtra(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    await seedRolesExtra(getModel)
  })

  // ────────────────────────────────────────────────────────────────
  // V8 — quien puede crear un referido
  // ────────────────────────────────────────────────────────────────

  describe('POST /api/referidos', () => {
    it('debe rechazar con 403 al rol EXTERNO', async () => {
      const externo = await createTestUser(getModel, {
        username: 'externo', correo: 'externo@otrodominio.com', roles: ['EXTERNO'],
      })

      const res = await request(app)
        .post('/api/referidos')
        .set(authHeader(externo))
        .send(REFERIDO_VALIDO)

      expect(res.status).toBe(403)
    })

    it('no debe persistir el referido creado por un EXTERNO', async () => {
      const externo = await createTestUser(getModel, {
        username: 'externo2', correo: 'externo2@otrodominio.com', roles: ['EXTERNO'],
      })

      await request(app)
        .post('/api/referidos')
        .set(authHeader(externo))
        .send(REFERIDO_VALIDO)

      const creados = await getModel('Referido').count()
      expect(creados).toBe(0)
    })

    it.each(['TRABAJADOR', 'RRHH', 'ADMIN', 'ADC', 'JefeRRHH'])(
      'debe permitir al rol interno %s',
      async (rol) => {
        const user = await createTestUser(getModel, {
          username: `u-${rol}`, correo: `${rol}@ecora.cl`, roles: [rol],
        })

        const res = await request(app)
          .post('/api/referidos')
          .set(authHeader(user))
          .send(REFERIDO_VALIDO)

        expect(res.status).toBe(201)
      }
    )

    // La guarda debe excluir EXTERNO, no enumerar los internos conocidos: un rol
    // interno que aun no existe tiene que funcionar sin tocar la guarda.
    it('debe permitir a un rol interno que hoy no existe en el sistema', async () => {
      const user = await createTestUser(getModel, {
        username: 'u-futuro', correo: 'futuro@ecora.cl', roles: ['ROL_FUTURO_NO_EXISTENTE'],
      })

      const res = await request(app)
        .post('/api/referidos')
        .set(authHeader(user))
        .send(REFERIDO_VALIDO)

      expect(res.status).toBe(201)
    })

    it('debe seguir exigiendo autenticacion (401)', async () => {
      const res = await request(app).post('/api/referidos').send(REFERIDO_VALIDO)

      expect(res.status).toBe(401)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // V9 — el postulante externo y su propia postulacion
  // ────────────────────────────────────────────────────────────────

  describe('acceso del postulante externo a su propia postulacion', () => {
    /** Postulacion externa: la registra RRHH, el dueño real es el postulante. */
    async function montarPostulacion() {
      const rrhh = await createTestUser(getModel, {
        username: 'rrhh', correo: 'rrhh@ecora.cl', roles: ['RRHH'],
      })
      const postulante = await createTestUser(getModel, {
        username: 'postulante', correo: 'postulante@otrodominio.com', roles: ['EXTERNO'],
      })
      const otroExterno = await createTestUser(getModel, {
        username: 'otro-externo', correo: 'otro@otrodominio.com', roles: ['EXTERNO'],
      })
      const trabajadorAjeno = await createTestUser(getModel, {
        username: 'ajeno', correo: 'ajeno@ecora.cl', roles: ['TRABAJADOR'],
      })

      const referido = await getModel('Referido').create({
        nombre: 'POSTULANTE DE PRUEBA',
        email: 'postulante@otrodominio.com',
        estado: 'PENDIENTE',
        creadoPorUserId: rrhh.id,
        postulanteUserId: postulante.id,
      })

      return { rrhh, postulante, otroExterno, trabajadorAjeno, referido }
    }

    it('el postulante debe poder ver su postulacion (GET /:id)', async () => {
      const { postulante, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(postulante))

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(referido.id)
    })

    it('el postulante debe poder ver el historial de su postulacion', async () => {
      const { postulante, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/historial`)
        .set(authHeader(postulante))

      expect(res.status).toBe(200)
    })

    it('otro EXTERNO no debe ver la postulacion ajena (403)', async () => {
      const { otroExterno, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(otroExterno))

      expect(res.status).toBe(403)
    })

    it('otro EXTERNO no debe ver el historial ajeno (403)', async () => {
      const { otroExterno, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/historial`)
        .set(authHeader(otroExterno))

      expect(res.status).toBe(403)
    })

    it('un TRABAJADOR ajeno no debe ver la postulacion (403)', async () => {
      const { trabajadorAjeno, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(trabajadorAjeno))

      expect(res.status).toBe(403)
    })

    it('RRHH debe seguir viendo la postulacion (200)', async () => {
      const { rrhh, referido } = await montarPostulacion()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(rrhh))

      expect(res.status).toBe(200)
    })

    // Coherencia entre recursos hermanos: hoy el postulante ve los adjuntos de
    // su postulacion pero no la postulacion misma. Ambos deben responder igual.
    it('el acceso a la postulacion y a sus adjuntos debe ser coherente', async () => {
      const { postulante, referido } = await montarPostulacion()

      const detalle = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(postulante))
      const adjuntos = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(postulante))

      expect(detalle.status).toBe(adjuntos.status)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Regresion: el dueño y el ADC asignado no deben verse afectados
  // ────────────────────────────────────────────────────────────────

  describe('regresion de los accesos que ya funcionaban', () => {
    it('el dueño y el ADC asignado siguen viendo el referido', async () => {
      const dueno = await createTestUser(getModel, {
        username: 'dueno', correo: 'dueno@ecora.cl', roles: ['TRABAJADOR'],
      })
      const adc = await createTestUser(getModel, {
        username: 'adc', correo: 'adc@ecora.cl', roles: ['ADC'],
      })

      const referido = await getModel('Referido').create({
        nombre: 'CANDIDATO',
        estado: 'PENDIENTE',
        creadoPorUserId: dueno.id,
        asignadoADCUserId: adc.id,
      })

      for (const user of [dueno, adc]) {
        const res = await request(app)
          .get(`/api/referidos/${referido.id}`)
          .set(authHeader(user))

        expect(res.status).toBe(200)
      }
    })
  })
})
