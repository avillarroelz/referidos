// backend/tests/unit/middleware/rateLimiters.test.js
// Linea base de los limitadores que YA existen, antes de subir
// express-rate-limit (8.3.2 cae en el rango 8.0.1-8.5.0 del advisory heredado
// de ip-address) y antes de agregar el limitador por IP del login.
//
// tests/setup.js sustituye todo el modulo por pasarelas que llaman a next(), asi
// que aca se carga el modulo REAL con jest.requireActual y se monta cada
// limitador en una app minima. Es la unica forma de observar el corte de verdad.

const express = require('express')
const request = require('supertest')

const limiters = jest.requireActual('../../../src/middleware/rateLimiters')

/**
 * App minima con un limitador montado. `trust proxy` permite simular clientes
 * distintos con X-Forwarded-For, que es como se comporta detras de Caddy.
 */
function appCon(limiter, { auth = null, status = 200 } = {}) {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json())
  if (auth) app.use((req, _res, next) => { req.auth = auth; next() })
  app.use(limiter)
  // `status` simula la respuesta del handler real. Importa en el login, que usa
  // skipSuccessfulRequests: solo los intentos FALLIDOS (401) consumen cuota.
  app.post('/x', (_req, res) => res.status(status).json({ ok: status < 400 }))
  app.get('/x', (_req, res) => res.status(status).json({ ok: status < 400 }))
  return app
}

/** Dispara n peticiones y devuelve la lista de codigos de estado. */
async function disparar(app, n, { body = {}, ip = '9.9.9.9', metodo = 'post' } = {}) {
  const codigos = []
  for (let i = 0; i < n; i++) {
    const res = await request(app)[metodo]('/x').set('X-Forwarded-For', ip).send(body)
    codigos.push(res.status)
  }
  return codigos
}

describe('Limitadores de tasa (comportamiento actual)', () => {
  describe('authLoginLimiter — cuenta por CORREO', () => {
    // skipSuccessfulRequests: true — solo los intentos FALLIDOS gastan cuota,
    // por eso el handler simulado responde 401 como un login con clave mala.
    it('permite 10 intentos fallidos del mismo correo y corta el 11', async () => {
      const app = appCon(limiters.authLoginLimiter, { status: 401 })

      const codigos = await disparar(app, 11, { body: { correo: 'uno@test.cl', password: 'x' } })

      expect(codigos.slice(0, 10).every(c => c === 401)).toBe(true)
      expect(codigos[10]).toBe(429)
    })

    it('lleva contadores separados por correo: agotar uno no afecta a otro', async () => {
      const app = appCon(limiters.authLoginLimiter, { status: 401 })

      await disparar(app, 11, { body: { correo: 'victima@test.cl', password: 'x' } })
      const otro = await disparar(app, 1, { body: { correo: 'tercero@test.cl', password: 'x' } })

      // Esta es la razon de ser del limitador por correo: que una oficina tras
      // NAT no se bloquee entera. Debe conservarse al agregar el de IP.
      expect(otro[0]).toBe(401)
    })

    it('devuelve un cuerpo de error con codigo y segundos de espera', async () => {
      const app = appCon(limiters.authLoginLimiter, { status: 401 })

      await disparar(app, 10, { body: { correo: 'cuerpo@test.cl', password: 'x' } })
      const res = await request(app).post('/x').send({ correo: 'cuerpo@test.cl', password: 'x' })

      expect(res.status).toBe(429)
      expect(res.body.code).toBe('TOO_MANY_REQUESTS')
      expect(typeof res.body.retryAfterSeconds).toBe('number')
    })
  })

  describe('authRegisterLimiter — 5 por hora', () => {
    it('permite 5 registros y corta el 6', async () => {
      const codigos = await disparar(appCon(limiters.authRegisterLimiter), 6)

      expect(codigos.slice(0, 5).every(c => c === 200)).toBe(true)
      expect(codigos[5]).toBe(429)
    })
  })

  describe('authRefreshLimiter — 20 por 15 min', () => {
    it('permite 20 y corta el 21', async () => {
      const codigos = await disparar(appCon(limiters.authRefreshLimiter), 21)

      expect(codigos.slice(0, 20).every(c => c === 200)).toBe(true)
      expect(codigos[20]).toBe(429)
    })
  })

  describe('publicFormLimiter — 5 por 15 min', () => {
    it('permite 5 envios y corta el 6', async () => {
      const codigos = await disparar(appCon(limiters.publicFormLimiter), 6)

      expect(codigos.slice(0, 5).every(c => c === 200)).toBe(true)
      expect(codigos[5]).toBe(429)
    })
  })

  describe('heavyOpsLimiter — 10 por 15 min, por usuario', () => {
    it('permite 10 operaciones del mismo usuario y corta la 11', async () => {
      const codigos = await disparar(appCon(limiters.heavyOpsLimiter, { auth: { id: 7 } }), 11)

      expect(codigos.slice(0, 10).every(c => c === 200)).toBe(true)
      expect(codigos[10]).toBe(429)
    })

    it('lleva contadores separados por usuario', async () => {
      const limiter = limiters.heavyOpsLimiter

      await disparar(appCon(limiter, { auth: { id: 101 } }), 11)
      const otro = await disparar(appCon(limiter, { auth: { id: 202 } }), 1)

      expect(otro[0]).toBe(200)
    })
  })

  describe('globalLimiter — exime las rutas de auth', () => {
    // Esta exencion es la mitad de la causa del password spraying: sin ella el
    // limitador global habria puesto un techo por IP sobre /auth/login.
    it('no cuenta las peticiones a /auth/*', async () => {
      const app = express()
      app.set('trust proxy', true)
      app.use(express.json())
      app.use('/api', limiters.globalLimiter)
      app.post('/api/auth/login', (_req, res) => res.json({ ok: true }))

      const codigos = []
      for (let i = 0; i < 30; i++) {
        codigos.push((await request(app).post('/api/auth/login').send({})).status)
      }

      expect(codigos.every(c => c === 200)).toBe(true)
    })
  })
  // ────────────────────────────────────────────────────────────────
  // V16 — techo por IP sobre el login (password spraying)
  // ────────────────────────────────────────────────────────────────

  describe('authLoginIpLimiter — techo por IP, sumado al de correo', () => {
    // El limitador por correo permite 10 fallos POR CORREO, y globalLimiter
    // exime /auth/*, asi que hoy una sola IP puede probar la misma clave contra
    // miles de correos distintos sin tocar ningun limite. Eso es spraying.
    it('corta a una misma IP que prueba muchos correos distintos', async () => {
      const app = appCon(limiters.authLoginIpLimiter, { status: 401 })

      const codigos = []
      for (let i = 0; i < 40; i++) {
        const res = await request(app)
          .post('/x')
          .set('X-Forwarded-For', '203.0.113.7')
          .send({ correo: `objetivo${i}@ecora.cl`, password: 'Primavera2026!' })
        codigos.push(res.status)
      }

      expect(codigos).toContain(429)
    })

    // El limitador nuevo NO puede convertirse en un DoS: si todas las IPs
    // compartieran contador, un atacante bloquearia el login de toda la empresa.
    it('lleva contadores separados por IP', async () => {
      const app = appCon(limiters.authLoginIpLimiter, { status: 401 })

      for (let i = 0; i < 40; i++) {
        await request(app).post('/x').set('X-Forwarded-For', '203.0.113.9')
          .send({ correo: `x${i}@ecora.cl`, password: 'x' })
      }

      const otraIp = await request(app).post('/x').set('X-Forwarded-For', '198.51.100.4')
        .send({ correo: 'legitimo@ecora.cl', password: 'x' })

      expect(otraIp.status).toBe(401)
    })

    // Los aciertos no deben gastar cuota: una oficina tras NAT hace muchos
    // logins correctos desde la misma IP y no puede quedarse fuera por eso.
    it('no consume cuota con los logins exitosos', async () => {
      const app = appCon(limiters.authLoginIpLimiter, { status: 200 })

      const codigos = []
      for (let i = 0; i < 40; i++) {
        const res = await request(app).post('/x').set('X-Forwarded-For', '203.0.113.20')
          .send({ correo: `ok${i}@ecora.cl`, password: 'x' })
        codigos.push(res.status)
      }

      expect(codigos.every(c => c === 200)).toBe(true)
    })

    it('responde 429 con el mismo formato de error que el resto', async () => {
      const app = appCon(limiters.authLoginIpLimiter, { status: 401 })

      let ultima
      for (let i = 0; i < 40; i++) {
        ultima = await request(app).post('/x').set('X-Forwarded-For', '203.0.113.33')
          .send({ correo: `y${i}@ecora.cl`, password: 'x' })
      }

      expect(ultima.status).toBe(429)
      expect(ultima.body.code).toBe('TOO_MANY_REQUESTS')
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Defecto detectado en el fallback por IP que ya existia
  // ────────────────────────────────────────────────────────────────

  describe('el fallback por IP del login debe distinguir IPs', () => {
    // ipKeyGenerator espera una IP en texto y hoy recibe el objeto `req`
    // completo, que colapsa a una unica clave compartida. Efecto: cuando el
    // cuerpo llega sin `correo`, TODAS las IPs comparten el mismo contador y
    // una sola puede agotarlo para las demas.
    it('agotar el fallback desde una IP no debe bloquear a otra', async () => {
      const app = appCon(limiters.authLoginLimiter, { status: 401 })

      // Sin `correo` en el cuerpo se cae al fallback por IP
      for (let i = 0; i < 11; i++) {
        await request(app).post('/x').set('X-Forwarded-For', '203.0.113.50').send({})
      }

      const otraIp = await request(app).post('/x')
        .set('X-Forwarded-For', '198.51.100.77').send({})

      expect(otraIp.status).toBe(401)
    })
  })
})
