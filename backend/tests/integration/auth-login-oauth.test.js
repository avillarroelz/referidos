// backend/tests/integration/auth-login-oauth.test.js
// Oraculo de enumeracion en el login contra cuentas creadas con Google.
//
// Una cuenta con auth_provider 'google' tiene password null. login() llama a
// compare(password, user.password) sin comprobarlo, y bcrypt LANZA con un hash
// null ("Illegal arguments"), asi que la peticion termina en 500 en vez de 401.
//
// La diferencia de codigo es la fuga: un atacante distingue un correo que no
// existe (401) de uno que si existe y es cuenta Google (500), sin conocer
// ninguna contraseña. Ademas ese camino se salta el conteo de failedAttempts.
//
// El patron correcto ya vive en este mismo controller: changePassword comprueba
// `if (!user.password)` antes de comparar. Login se lo salto.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles } = require('../helpers/auth')
const { hash } = require('../../src/utils/hash')

const PASSWORD_VALIDA = 'ClaveDePrueba123'

describe('Login contra cuentas sin contraseña (OAuth)', () => {
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

  /** Cuenta creada por el flujo de Google: sin contraseña local. */
  async function crearCuentaGoogle(correo) {
    return getModel('Usuario').create({
      username: 'usuario-google',
      correo,
      password: null,
      estado: true,
      auth_provider: 'google',
      google_id: 'google-id-123',
    })
  }

  function intentarLogin(correo) {
    return request(app).post('/api/auth/login').send({ correo, password: PASSWORD_VALIDA })
  }

  it('responde 401 al intentar login con contraseña sobre una cuenta Google', async () => {
    await crearCuentaGoogle('google@ecora.cl')

    const res = await intentarLogin('google@ecora.cl')

    expect(res.status).toBe(401)
  })

  // El corazon del hallazgo: la respuesta tiene que ser indistinguible de la de
  // un correo que no existe, tanto en codigo como en cuerpo.
  it('no permite distinguir una cuenta Google de un correo inexistente', async () => {
    await crearCuentaGoogle('existe-google@ecora.cl')

    const cuentaGoogle = await intentarLogin('existe-google@ecora.cl')
    const correoInexistente = await intentarLogin('no-existe@ecora.cl')

    expect(cuentaGoogle.status).toBe(correoInexistente.status)
    expect(cuentaGoogle.body).toEqual(correoInexistente.body)
  })

  it('no filtra que la cuenta usa Google ni detalle interno del error', async () => {
    await crearCuentaGoogle('otro-google@ecora.cl')

    const res = await intentarLogin('otro-google@ecora.cl')

    const cuerpo = JSON.stringify(res.body).toLowerCase()
    expect(cuerpo).not.toContain('google')
    expect(cuerpo).not.toContain('oauth')
    expect(cuerpo).not.toContain('illegal arguments')
    expect(cuerpo).not.toContain('bcrypt')
  })

  it('el login con contraseña de una cuenta local sigue funcionando', async () => {
    const usuario = await getModel('Usuario').create({
      username: 'usuario-local',
      correo: 'local@ecora.cl',
      password: await hash(PASSWORD_VALIDA),
      estado: true,
      auth_provider: 'local',
    })

    const res = await request(app)
      .post('/api/auth/login')
      .send({ correo: usuario.correo, password: PASSWORD_VALIDA })

    expect(res.status).toBe(200)
    expect(res.body.user.correo).toBe('local@ecora.cl')
  })

  it('una contraseña incorrecta sobre cuenta local sigue devolviendo el mismo 401', async () => {
    await getModel('Usuario').create({
      username: 'usuario-local2',
      correo: 'local2@ecora.cl',
      password: await hash(PASSWORD_VALIDA),
      estado: true,
      auth_provider: 'local',
    })
    await crearCuentaGoogle('google2@ecora.cl')

    const claveMala = await request(app)
      .post('/api/auth/login')
      .send({ correo: 'local2@ecora.cl', password: 'OtraClaveDistinta123' })
    const cuentaGoogle = await intentarLogin('google2@ecora.cl')

    // Las tres vias de fallo deben ser indistinguibles entre si.
    expect(claveMala.status).toBe(401)
    expect(cuentaGoogle.status).toBe(401)
    expect(claveMala.body).toEqual(cuentaGoogle.body)
  })
})
