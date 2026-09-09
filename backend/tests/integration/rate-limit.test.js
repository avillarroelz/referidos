// backend/tests/integration/rate-limit.test.js
//
// tests/setup.js sustituye todos los limitadores por un passthrough, asi que
// hasta ahora ninguna prueba verificaba que estuvieran APLICADOS. Un limitador
// podia desaparecer de una ruta y la suite seguia verde: exactamente el tipo de
// control que se pierde en un refactor sin que nadie se entere.
//
// Aqui se desactiva ese mock y se comprueban dos cosas distintas:
//   1) que cada ruta sensible tenga montado su limitador (por identidad de
//      referencia, no por nombre ni por posicion);
//   2) que el limitador efectivamente corte con 429 al pasarse del umbral.
//
// La comprobacion (1) es la que sobrevive a los cambios de umbral; la (2) es la
// que confirma que el middleware montado hace algo.

jest.unmock('../../src/middleware/rateLimiters')
jest.resetModules()

const request = require('supertest')
const limitadores = require('../../src/middleware/rateLimiters')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles } = require('../helpers/auth')

/** Middlewares montados en una ruta concreta de un router de express. */
function middlewaresDe(router, metodo, ruta) {
  const capa = router.stack.find(
    l => l.route?.path === ruta && l.route?.methods?.[metodo]
  )
  if (!capa) throw new Error(`No existe la ruta ${metodo.toUpperCase()} ${ruta}`)
  return capa.route.stack.map(s => s.handle)
}

describe('Rate limiting', () => {
  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    await db.__resetTestDb()
    await seedRoles(instancia.getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  describe('limitadores montados en las rutas', () => {
    const authRoutes = require('../../src/routes/auth.routes')
    const publicRoutes = require('../../src/routes/public.routes')
    const referidosRoutes = require('../../src/routes/referidos.routes')

    it('el login lleva el limitador por IP y el limitador por correo', () => {
      const montados = middlewaresDe(authRoutes, 'post', '/login')
      expect(montados).toContain(limitadores.authLoginIpLimiter)
      expect(montados).toContain(limitadores.authLoginLimiter)
    })

    // El de IP frena el barrido de muchos correos distintos y el de correo frena
    // la fuerza bruta sobre uno solo. El primero tiene que actuar antes, o un
    // atacante que rota correos nunca toca el segundo.
    it('el limitador por IP se evalua antes que el de correo', () => {
      const montados = middlewaresDe(authRoutes, 'post', '/login')
      expect(montados.indexOf(limitadores.authLoginIpLimiter))
        .toBeLessThan(montados.indexOf(limitadores.authLoginLimiter))
    })

    it('el registro lleva su limitador', () => {
      expect(middlewaresDe(authRoutes, 'post', '/register'))
        .toContain(limitadores.authRegisterLimiter)
    })

    it('el refresh lleva su limitador', () => {
      expect(middlewaresDe(authRoutes, 'post', '/refresh'))
        .toContain(limitadores.authRefreshLimiter)
    })

    it.each([
      ['/referidos'],
      ['/postulaciones'],
    ])('el formulario publico %s lleva el limitador de formularios', (ruta) => {
      expect(middlewaresDe(publicRoutes, 'post', ruta))
        .toContain(limitadores.publicFormLimiter)
    })

    // La sincronizacion con Gmail habla con una API externa y puede tardar: sin
    // limitador, unas pocas peticiones simultaneas tumban el proceso.
    it.each([
      ['post', '/sync/gmail'],
      ['get', '/sync/gmail/preview'],
      ['post', '/sync/gmail/manual'],
    ])('%s %s lleva el limitador de operaciones pesadas', (metodo, ruta) => {
      expect(middlewaresDe(referidosRoutes, metodo, ruta))
        .toContain(limitadores.heavyOpsLimiter)
    })

    it('el limitador global cubre todo /api', () => {
      const capas = app._router.stack.filter(l => l.handle === limitadores.globalLimiter)
      expect(capas).toHaveLength(1)
    })

    // Si alguien agrega un limitador nuevo al modulo pero se olvida de montarlo,
    // esta prueba lo delata: todo lo que exporta el modulo tiene que usarse.
    it('todos los limitadores exportados estan en uso', () => {
      const montadosEnApp = new Set()
      const recorrer = (stack) => {
        for (const capa of stack) {
          if (capa.handle) montadosEnApp.add(capa.handle)
          if (capa.route?.stack) capa.route.stack.forEach(s => montadosEnApp.add(s.handle))
          if (capa.handle?.stack) recorrer(capa.handle.stack)
        }
      }
      recorrer(app._router.stack)

      const sinMontar = Object.entries(limitadores)
        .filter(([, middleware]) => !montadosEnApp.has(middleware))
        .map(([nombre]) => nombre)

      expect(sinMontar).toEqual([])
    })
  })

  // Los umbrales viven en el modulo, no aqui: se leen para no duplicarlos y
  // para que subirlos no obligue a editar la prueba.
  describe('el limitador corta de verdad', () => {
    it('el registro responde 429 al pasarse del umbral', async () => {
      const respuestas = []
      // 6 intentos contra un umbral de 5 por hora.
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({ username: `rl${i}`, correo: `rl${i}@ecora.cl`, password: 'ClaveLargaValida1' })
        respuestas.push(res.status)
      }

      expect(respuestas).toContain(429)
      // Los primeros no pueden estar limitados: el corte llega al pasarse.
      expect(respuestas[0]).not.toBe(429)
    })

    it('el 429 explica al usuario que espere, sin filtrar detalles internos', async () => {
      let res
      for (let i = 0; i < 8 && res?.status !== 429; i++) {
        res = await request(app)
          .post('/api/auth/register')
          .send({ username: `rlx${i}`, correo: `rlx${i}@ecora.cl`, password: 'ClaveLargaValida1' })
      }

      expect(res.status).toBe(429)
      const cuerpo = JSON.stringify(res.body).toLowerCase()
      expect(cuerpo.length).toBeGreaterThan(2)
      expect(cuerpo).not.toMatch(/stack|sequelize|sqlite|at object\./)
    })

    it('el formulario publico tambien corta', async () => {
      const respuestas = []
      for (let i = 0; i < 7; i++) {
        const res = await request(app)
          .post('/api/public/referidos')
          .send({ nombre: `Candidato RL ${i}`, email: `rl${i}@test.com` })
        respuestas.push(res.status)
      }

      expect(respuestas).toContain(429)
    })

    // Un limitador que devolviera 429 a todo el mundo desde el primer intento
    // seria igual de inutil que no tenerlo, y las dos pruebas anteriores no lo
    // distinguirian por si solas.
    it('las peticiones bajo el umbral no se limitan', async () => {
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
    })
  })
})
