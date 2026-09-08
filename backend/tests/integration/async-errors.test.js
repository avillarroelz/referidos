// backend/tests/integration/async-errors.test.js
// Disponibilidad: un fallo de base de datos debe responder 500, nunca colgar.
//
// Express 4 (4.22.1 instalado) no captura la promesa rechazada de un handler
// async: el rechazo se va a unhandledRejection, no llega al errorHandler y la
// peticion se queda SIN RESPUESTA para siempre. No hay 500, no hay error, no
// hay nada. Y cada peticion colgada retiene su conexion del pool, asi que un
// problema transitorio de base —una caida, un deadlock, un timeout de consulta,
// una tabla bloqueada— escala a indisponibilidad total del backend.
//
// Controladores expuestos hoy: kpis (8 handlers async, 0 try), unidadNegocio
// (6/0), persona (5/0), lineaNegocio (4/0) y roles (9 con solo 3 try).
//
// El fallo se provoca soltando la tabla que el handler necesita. Es una forma
// realista de "la base no responde" y no depende del motor: contra SQLite en
// test y contra PostgreSQL en produccion, el efecto sobre el handler es el
// mismo, una promesa rechazada que nadie captura.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')
const { config } = require('../../src/config')

// Si el handler no responde, superagent aborta con ECONNABORTED y asi se
// distingue "colgado" de "respondio con error".
const LIMITE_MS = 3000

/**
 * Ejecuta la peticion y clasifica el desenlace, en vez de dejar que un cuelgue
 * reviente el test con un error de red poco informativo.
 */
async function pedir(peticion) {
  try {
    const res = await peticion.timeout({ deadline: LIMITE_MS })
    return { colgo: false, status: res.status, body: res.body }
  } catch (err) {
    if (err.timeout || err.code === 'ECONNABORTED') return { colgo: true }
    throw err
  }
}

describe('Fallo de base de datos en handlers async', () => {
  let getModel
  let sequelize
  let admin

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    sequelize = instance.sequelize
    await seedRoles(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    // sync() rehace las tablas que los casos anteriores dejaron caidas.
    await sequelize.sync({ force: true })
    await seedRoles(getModel)
    admin = await createTestUser(getModel, {
      username: 'admin-async', correo: 'admin-async@ecora.cl', roles: ['ADMIN'],
    })
  })

  describe('GET /api/unidades', () => {
    it('responde 200 con la tabla presente', async () => {
      const r = await pedir(request(app).get('/api/unidades').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(200)
    })

    it('responde 500 y NO cuelga cuando la tabla no existe', async () => {
      await sequelize.query('DROP TABLE unidad_negocio')

      const r = await pedir(request(app).get('/api/unidades').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })

    // El errorHandler solo oculta el detalle cuando isProd es true, y la suite
    // corre con isProd false. Sin forzarlo, este caso mediria el mensaje de
    // desarrollo y no diria nada sobre produccion, que es donde importa.
    it('no filtra el detalle de la base de datos en produccion', async () => {
      const original = config.isProd
      config.isProd = true
      try {
        await sequelize.query('DROP TABLE unidad_negocio')

        const r = await pedir(request(app).get('/api/unidades').set(authHeader(admin)))

        expect(r.status).toBe(500)
        const cuerpo = JSON.stringify(r.body).toLowerCase()
        expect(cuerpo).not.toContain('unidad_negocio')
        expect(cuerpo).not.toContain('sqlite')
        expect(cuerpo).not.toContain('sequelize')
        expect(cuerpo).not.toContain('no such table')
      } finally {
        config.isProd = original
      }
    })

    // En desarrollo el detalle SI se muestra, y es deliberado: sirve para
    // depurar. Queda fijado para que nadie lo confunda con una fuga.
    it('si muestra el detalle en desarrollo, que es lo buscado', async () => {
      await sequelize.query('DROP TABLE unidad_negocio')

      const r = await pedir(request(app).get('/api/unidades').set(authHeader(admin)))

      expect(r.status).toBe(500)
      expect(JSON.stringify(r.body)).toContain('unidad_negocio')
    })
  })

  describe('GET /api/kpis/overview', () => {
    it('responde 500 y NO cuelga cuando la tabla de referidos no existe', async () => {
      await sequelize.query('DROP TABLE referidos')

      const r = await pedir(request(app).get('/api/kpis/overview').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })
  })

  describe('GET /api/kpis/series (SQL crudo)', () => {
    it('responde 500 y NO cuelga cuando la consulta falla', async () => {
      await sequelize.query('DROP TABLE referidos')

      const r = await pedir(request(app).get('/api/kpis/series').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })
  })

  describe('GET /api/personas', () => {
    it('responde 500 y NO cuelga cuando la tabla no existe', async () => {
      await sequelize.query('DROP TABLE personas')

      const r = await pedir(request(app).get('/api/personas').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })
  })

  describe('GET /api/lineas', () => {
    it('responde 500 y NO cuelga cuando la tabla no existe', async () => {
      await sequelize.query('DROP TABLE linea_negocio')

      const r = await pedir(request(app).get('/api/lineas').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })
  })

  describe('GET /api/roles/usuarios', () => {
    it('responde 500 y NO cuelga cuando la tabla de usuarios no existe', async () => {
      await sequelize.query('DROP TABLE usuarios')

      const r = await pedir(request(app).get('/api/roles/usuarios').set(authHeader(admin)))

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(500)
    })
  })
  // ────────────────────────────────────────────────────────────────
  // El envoltorio no puede haber roto los validators
  // ────────────────────────────────────────────────────────────────

  describe('los validators siguen aplicandose tras envolver los exports', () => {
    // wrapHandlers solo toca funciones y los validators son ARRAYS. Si alguna
    // vez se envolvieran, las rutas dejarian de validar EN SILENCIO y estos
    // casos pasarian de 400 a 201.
    it('POST /api/unidades rechaza un cuerpo invalido con 400', async () => {
      const r = await pedir(
        request(app).post('/api/unidades').set(authHeader(admin)).send({})
      )

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(400)
    })

    it('POST /api/lineas rechaza un cuerpo invalido con 400', async () => {
      const r = await pedir(
        request(app).post('/api/lineas').set(authHeader(admin)).send({})
      )

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(400)
    })

    it('GET /api/kpis/series rechaza un intervalo invalido con 400', async () => {
      const r = await pedir(
        request(app).get('/api/kpis/series?interval=; DROP TABLE referidos').set(authHeader(admin))
      )

      expect(r.colgo).toBe(false)
      expect(r.status).toBe(400)
    })
  })
})
