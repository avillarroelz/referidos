// backend/tests/integration/comentarios-acceso.test.js
// Control de acceso a nivel de objeto (IDOR) en los comentarios de un referido.
//
// Hoy comentarios.routes.js solo aplica authRequired y comentarios.controller.js
// comprueba unicamente que el referido EXISTA (findByPk), nunca que quien pide
// tenga acceso a el. El recurso hermano si lo hace: adjuntos.controller.js
// define assertReferidoAccess (privilegiado / dueño / postulante / ADC asignado)
// y lo aplica en sus cuatro operaciones, colgando de la MISMA ruta padre.
//
// La exposicion NO es simetrica, y el test lo separa a proposito:
//
//   ESCRITURA (POST): fuga TOTAL. Cualquier autenticado, EXTERNO incluido,
//   escribe en el expediente de cualquier referido por id, elige a que roles
//   queda visible y dispara la notificacion a RRHH y al dueño. Es manipulacion
//   de expediente y phishing interno con remitente confiable.
//
//   LECTURA (GET): fuga ACOTADA. La ruta deja entrar a cualquiera, pero
//   listar() filtra por visibleParaRoles, y el default es 'RRHH,ADC,ADMIN', asi
//   que un TRABAJADOR o un EXTERNO ajenos normalmente reciben 200 con lista
//   vacia en vez de 403. El filtro es por ROL GLOBAL, no por pertenencia: en
//   cuanto un comentario incluye su rol, lo leen aunque el referido sea ajeno.
//   El ultimo bloque de este archivo demuestra ese caso concreto.
//
// Todos los casos esperan el comportamiento CORRECTO (403 para el ajeno), asi
// que en rojo miden el agujero y en verde lo fijan.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

/** seedRoles() no siembra EXTERNO; findOrCreate lo deja idempotente. */
async function seedRolExterno(getModel) {
  const Rol = getModel('Rol')
  const [rol] = await Rol.findOrCreate({
    where: { nombre: 'EXTERNO' },
    defaults: { nombre: 'EXTERNO', descripcion: 'Rol EXTERNO para testing' },
  })
  return rol
}

describe('Control de acceso a comentarios de un referido (IDOR)', () => {
  let getModel

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
    await seedRolExterno(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    await seedRolExterno(getModel)
  })

  /**
   * Escenario base: un referido creado por `dueño` y asignado a `adc`, mas los
   * terceros que no deberian tocarlo.
   */
  async function montarEscenario() {
    const dueno = await createTestUser(getModel, {
      username: 'dueno', correo: 'dueno@test.com', roles: ['TRABAJADOR'],
    })
    const ajeno = await createTestUser(getModel, {
      username: 'ajeno', correo: 'ajeno@test.com', roles: ['TRABAJADOR'],
    })
    const externo = await createTestUser(getModel, {
      username: 'externo', correo: 'externo@otrodominio.com', roles: ['EXTERNO'],
    })
    const adc = await createTestUser(getModel, {
      username: 'adc', correo: 'adc@test.com', roles: ['ADC'],
    })
    const rrhh = await createTestUser(getModel, {
      username: 'rrhh', correo: 'rrhh@test.com', roles: ['RRHH'],
    })

    const referido = await getModel('Referido').create({
      nombre: 'CANDIDATO DEL DUENO',
      email: 'candidato@test.com',
      estado: 'PENDIENTE',
      creadoPorUserId: dueno.id,
      asignadoADCUserId: adc.id,
    })

    return { dueno, ajeno, externo, adc, rrhh, referido }
  }

  // ────────────────────────────────────────────────────────────────
  // ESCRITURA — la fuga total
  // ────────────────────────────────────────────────────────────────

  describe('POST /api/referidos/:id/comentarios', () => {
    it('debe rechazar con 403 a un TRABAJADOR ajeno al referido', async () => {
      const { ajeno, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(ajeno))
        .send({ mensaje: 'Comentario de un tercero sin relacion con este referido' })

      expect(res.status).toBe(403)
    })

    it('debe rechazar con 403 a un EXTERNO ajeno al referido', async () => {
      const { externo, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(externo))
        .send({ mensaje: 'Postulante externo escribiendo en un expediente ajeno' })

      expect(res.status).toBe(403)
    })

    it('no debe persistir el comentario del ajeno', async () => {
      const { ajeno, referido } = await montarEscenario()

      await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(ajeno))
        .send({ mensaje: 'No deberia quedar guardado' })

      const guardados = await getModel('Comentario').count({ where: { referidoId: referido.id } })
      expect(guardados).toBe(0)
    })

    // El agravante: el ajeno elige a que roles queda visible su comentario, asi
    // que puede plantar un mensaje dirigido a ADMIN dentro de un expediente que
    // no le corresponde.
    it('no debe permitir al ajeno inyectar un comentario visible para ADMIN', async () => {
      const { ajeno, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(ajeno))
        .send({ mensaje: 'Mensaje dirigido a un admin', visibleParaRoles: 'ADMIN' })

      expect(res.status).toBe(403)
    })

    // Decision 30-09: el creador TRABAJADOR ya no comenta (antes 201)
    it('debe rechazar con 403 al dueño TRABAJADOR del referido', async () => {
      const { dueno, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(dueno))
        .send({ mensaje: 'Comentario del dueño del referido' })

      expect(res.status).toBe(403)
    })

    it('debe permitir al ADC asignado', async () => {
      const { adc, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(adc))
        .send({ mensaje: 'Dictamen preliminar del ADC asignado' })

      expect(res.status).toBe(201)
    })

    it('debe permitir a un privilegiado (RRHH)', async () => {
      const { rrhh, referido } = await montarEscenario()

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(rrhh))
        .send({ mensaje: 'Observacion de RRHH' })

      expect(res.status).toBe(201)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // LECTURA — la fuga acotada
  // ────────────────────────────────────────────────────────────────

  describe('GET /api/referidos/:id/comentarios', () => {
    it('debe rechazar con 403 a un TRABAJADOR ajeno al referido', async () => {
      const { ajeno, referido } = await montarEscenario()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(ajeno))

      expect(res.status).toBe(403)
    })

    it('debe rechazar con 403 a un EXTERNO ajeno al referido', async () => {
      const { externo, referido } = await montarEscenario()

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(externo))

      expect(res.status).toBe(403)
    })

    // Decision 30-09: el dueño TRABAJADOR ya no lee (antes 200)
    it('debe permitir al ADC asignado y a RRHH', async () => {
      const { adc, rrhh, referido } = await montarEscenario()

      for (const user of [adc, rrhh]) {
        const res = await request(app)
          .get(`/api/referidos/${referido.id}/comentarios`)
          .set(authHeader(user))

        expect(res.status).toBe(200)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Decision 30-09: comentarios solo para RRHH, JefeRRHH, ADC asignado y ADMIN
  // ────────────────────────────────────────────────────────────────

  describe('decision 30-09: solo RRHH, JefeRRHH, ADMIN y ADC asignado', () => {
    it('JefeRRHH ve un comentario escrito por RRHH con la visibilidad por defecto', async () => {
      const { rrhh, referido } = await montarEscenario()
      const jefe = await createTestUser(getModel, {
        username: 'jefe', correo: 'jefe@test.com', roles: ['JefeRRHH'],
      })

      // Guardado con el default historico 'RRHH,ADC,ADMIN' (sin JefeRRHH)
      await getModel('Comentario').create({
        referidoId: referido.id,
        autorUserId: rrhh.id,
        mensaje: 'Observacion de RRHH',
        visibleParaRoles: 'RRHH,ADC,ADMIN',
      })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(jefe))

      expect(res.status).toBe(200)
      expect(res.body.map(c => c.mensaje)).toEqual(['Observacion de RRHH'])
    })

    it('TRABAJADOR creador del referido recibe 403 en GET y POST', async () => {
      const { dueno, referido } = await montarEscenario()

      const get = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(dueno))
      const post = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(dueno))
        .send({ mensaje: 'El creador no comenta' })

      expect(get.status).toBe(403)
      expect(post.status).toBe(403)
      expect(await getModel('Comentario').count({ where: { referidoId: referido.id } })).toBe(0)
    })

    it('EXTERNO postulante del referido recibe 403 en GET y POST', async () => {
      const { externo, referido } = await montarEscenario()
      await referido.update({ postulanteUserId: externo.id })

      const get = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(externo))
      const post = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(externo))
        .send({ mensaje: 'El postulante no comenta' })

      expect(get.status).toBe(403)
      expect(post.status).toBe(403)
    })

    it('ADC no asignado recibe 403 en GET y POST; el asignado recibe 200', async () => {
      const { adc, referido } = await montarEscenario()
      const otroAdc = await createTestUser(getModel, {
        username: 'adc2', correo: 'adc2@test.com', roles: ['ADC'],
      })

      const getOtro = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(otroAdc))
      const postOtro = await request(app)
        .post(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(otroAdc))
        .send({ mensaje: 'ADC ajeno' })
      const getAsignado = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(adc))

      expect(getOtro.status).toBe(403)
      expect(postOtro.status).toBe(403)
      expect(getAsignado.status).toBe(200)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Por que visibleParaRoles NO sustituye al control de pertenencia
  // ────────────────────────────────────────────────────────────────

  describe('el filtro por visibleParaRoles no es control de acceso', () => {
    // Con el default 'RRHH,ADC,ADMIN' un TRABAJADOR ajeno recibe lista vacia y
    // la fuga pasa desapercibida. Basta un comentario que incluya su rol para
    // que lea contenido de un expediente que no le corresponde: el filtro mira
    // el ROL, nunca la pertenencia al referido.
    it('un TRABAJADOR ajeno no debe leer un comentario visible para TRABAJADOR', async () => {
      const { dueno, ajeno, referido } = await montarEscenario()

      await getModel('Comentario').create({
        referidoId: referido.id,
        autorUserId: dueno.id,
        mensaje: 'Dato reservado del candidato, visible para el rol TRABAJADOR',
        visibleParaRoles: 'TRABAJADOR',
      })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/comentarios`)
        .set(authHeader(ajeno))

      expect(res.status).toBe(403)
      expect(JSON.stringify(res.body)).not.toContain('Dato reservado del candidato')
    })
  })
})
