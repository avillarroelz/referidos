// backend/tests/integration/csrf.test.js
//
// tests/setup.js mockea csrf-csrf a un passthrough para que el resto de la
// suite no tenga que manejar el double-submit cookie. El efecto secundario es
// que NINGUNA prueba verificaba que la proteccion CSRF exista: podia
// desaparecer de app.js entera y la suite habria seguido verde.
//
// Este archivo desactiva ese mock (jest.unmock + resetModules antes de cargar
// la app) y prueba la proteccion REAL. Es el unico archivo que lo hace, asi que
// no afecta al resto.

jest.unmock('csrf-csrf')
jest.resetModules()

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

const COOKIE_CSRF = '__csrf'
const CABECERA_CSRF = 'x-csrf-token'

/** Pide un token al endpoint y devuelve el par cookie + token que van juntos. */
async function obtenerCsrf() {
  const res = await request(app).get('/api/csrf-token')
  const cookies = res.headers['set-cookie'] || []
  const cookie = cookies.find(c => c.startsWith(`${COOKIE_CSRF}=`))
  return { token: res.body.csrfToken, cookie: cookie?.split(';')[0] }
}

describe('Proteccion CSRF', () => {
  let admin

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    await db.__resetTestDb()
    await seedRoles(instancia.getModel)
    admin = await createTestUser(instancia.getModel, {
      username: 'csrf-admin',
      correo: 'csrf-admin@ecora.cl',
      roles: ['ADMIN'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  describe('el endpoint que reparte el token', () => {
    it('devuelve un token y su cookie', async () => {
      const { token, cookie } = await obtenerCsrf()
      expect(typeof token).toBe('string')
      expect(token.length).toBeGreaterThan(20)
      expect(cookie).toBeDefined()
    })

    // La cookie del double-submit no debe ser legible por JavaScript: si lo
    // fuera, un XSS podria leerla y falsificar la peticion completa.
    it('la cookie es httpOnly', async () => {
      const res = await request(app).get('/api/csrf-token')
      const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith(`${COOKIE_CSRF}=`))
      expect(cookie.toLowerCase()).toContain('httponly')
    })

    it('entrega tokens distintos en llamadas sucesivas', async () => {
      const a = await obtenerCsrf()
      const b = await obtenerCsrf()
      expect(a.token).not.toBe(b.token)
    })
  })

  describe('peticiones mutantes protegidas', () => {
    const MUTANTES = [
      ['post', '/api/roles', { nombre: 'ROL_CSRF' }],
      ['delete', '/api/roles/1', undefined],
      ['post', '/api/unidades', { nombre: 'Unidad CSRF' }],
      ['put', '/api/unidades/1', { nombre: 'Otra' }],
      ['delete', '/api/unidades/1', undefined],
      ['patch', '/api/notificaciones/leer-todas', undefined],
      ['post', '/api/referidos', { nombre: 'X' }],
      ['patch', '/api/referidos/1/estado', { estado: 'EN_REVISION' }],
    ]

    it.each(MUTANTES)('%s %s sin token ni cookie es rechazada', async (metodo, ruta, cuerpo) => {
      const res = await request(app)[metodo](ruta).set(authHeader(admin)).send(cuerpo)
      expect(res.status).toBe(403)
      expect(String(res.body.error || res.body.message || '')).toMatch(/csrf/i)
    })

    it.each(MUTANTES)('%s %s con cookie pero sin cabecera es rechazada', async (metodo, ruta, cuerpo) => {
      const { cookie } = await obtenerCsrf()
      const res = await request(app)[metodo](ruta)
        .set(authHeader(admin))
        .set('Cookie', cookie)
        .send(cuerpo)
      expect(res.status).toBe(403)
    })

    it.each(MUTANTES)('%s %s con cabecera pero sin cookie es rechazada', async (metodo, ruta, cuerpo) => {
      const { token } = await obtenerCsrf()
      const res = await request(app)[metodo](ruta)
        .set(authHeader(admin))
        .set(CABECERA_CSRF, token)
        .send(cuerpo)
      expect(res.status).toBe(403)
    })

    // El punto del double-submit: cookie y cabecera tienen que ser el par que
    // el servidor emitio juntos. Mezclar dos sesiones no puede pasar.
    it('con la cookie de una sesion y el token de otra es rechazada', async () => {
      const primera = await obtenerCsrf()
      const segunda = await obtenerCsrf()

      const res = await request(app)
        .post('/api/roles')
        .set(authHeader(admin))
        .set('Cookie', primera.cookie)
        .set(CABECERA_CSRF, segunda.token)
        .send({ nombre: 'ROL_MEZCLADO' })

      expect(res.status).toBe(403)
    })

    it('con un token inventado es rechazada', async () => {
      const { cookie } = await obtenerCsrf()
      const res = await request(app)
        .post('/api/roles')
        .set(authHeader(admin))
        .set('Cookie', cookie)
        .set(CABECERA_CSRF, 'token-inventado')
        .send({ nombre: 'ROL_FALSO' })

      expect(res.status).toBe(403)
    })

    it('con el par correcto la peticion llega al controlador', async () => {
      const { token, cookie } = await obtenerCsrf()
      const res = await request(app)
        .post('/api/roles')
        .set(authHeader(admin))
        .set('Cookie', cookie)
        .set(CABECERA_CSRF, token)
        .send({ nombre: 'ROL_CSRF_OK' })

      expect(res.status).not.toBe(403)
      expect([200, 201]).toContain(res.status)
    })

    // El CSRF se comprueba antes que los permisos: un rol sin autorizacion que
    // ademas no manda token debe frenarse en la primera barrera.
    it('la falta de CSRF frena incluso a un usuario sin sesion', async () => {
      const res = await request(app).post('/api/roles').send({ nombre: 'X' })
      expect(res.status).toBe(403)
      expect(String(res.body.error || '')).toMatch(/csrf/i)
    })
  })

  describe('metodos que no modifican estado', () => {
    it.each([
      ['/api/roles'],
      ['/api/unidades'],
      ['/api/notificaciones'],
      ['/api/referidos'],
    ])('GET %s no exige token CSRF', async (ruta) => {
      const res = await request(app).get(ruta).set(authHeader(admin))
      expect(res.status).not.toBe(403)
    })
  })

  // Cada exencion tiene que existir por una razon escrita. Si alguien agrega un
  // prefijo a skipPaths sin justificarlo, este bloque es donde tiene que
  // aparecer la explicacion.
  describe('rutas exentas a proposito', () => {
    it('POST /api/auth/login no exige CSRF: no hay sesion previa que proteger', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'csrf-admin@ecora.cl', password: 'clave-incorrecta-larga' })

      expect(res.status).not.toBe(403)
      expect(res.status).toBe(401)
    })

    it('POST /api/auth/register no exige CSRF por la misma razon', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ username: 'x', correo: 'no-es-correo', password: 'corta' })

      // 400 por validacion: lo que importa es que no lo frene el CSRF.
      expect(res.status).not.toBe(403)
    })

    it('POST /api/public/referidos no exige CSRF: es un formulario anonimo', async () => {
      const res = await request(app)
        .post('/api/public/referidos')
        .send({ nombre: 'Candidato Publico', email: 'publico@test.com' })

      expect(res.status).not.toBe(403)
    })

    // La integracion se autentica con X-API-Key, no con cookies. Un navegador
    // no adjunta esa cabecera sola, asi que no hay superficie CSRF; el 401 de
    // abajo confirma que la barrera que la protege es la API key.
    it('PATCH /api/integracion no exige CSRF pero si API key', async () => {
      const res = await request(app)
        .patch('/api/integracion/1/resultado-reclutamiento')
        .send({ resultado: 'CONTRATADO' })

      expect([401, 503]).toContain(res.status)
    })

    it('GET /api/health queda fuera por ser lectura', async () => {
      const res = await request(app).get('/api/health')
      expect(res.status).toBe(200)
    })
  })

  // Un prefijo que se parezca a uno exento no puede colarse: skipPaths compara
  // con startsWith, asi que "/auth-falso/" no debe pasar por exento.
  describe('las exenciones no se pueden imitar', () => {
    it.each([
      ['/api/authfalso/algo'],
      ['/api/publico/algo'],
      ['/api/integracionfalsa/algo'],
    ])('POST %s sigue exigiendo CSRF', async (ruta) => {
      const res = await request(app).post(ruta).send({})
      // 403 del CSRF, no 404: la barrera actua antes que el enrutado.
      expect(res.status).toBe(403)
    })
  })
})
