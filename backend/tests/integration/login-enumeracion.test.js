// backend/tests/integration/login-enumeracion.test.js
// V22: el login delataba que una cuenta existe sin conocer su contraseña.
//
// El mensaje ya era uniforme entre "no existe" y "clave equivocada", pero el
// estado de la cuenta se resolvia ANTES de comparar la contraseña:
//   - cuenta bloqueada -> 423 con lockedUntil
//   - cuenta deshabilitada -> 403 "Usuario deshabilitado"
// Los dos confirman que la cuenta EXISTE a quien no tiene credencial alguna. Y
// como el bloqueo salta a los 5 intentos, se podia bloquear una cuenta a
// proposito para usar el 423 como oraculo, que ademas es un DoS dirigido.
// Habia ademas diferencia de tiempo: sin usuario no se ejecutaba bcrypt.
//
// Orden nuevo: la contraseña se valida SIEMPRE y primero; el estado decide el
// mensaje despues. Sin credencial correcta todas las respuestas son iguales.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser } = require('../helpers/auth')
const bcrypt = require('bcryptjs')

const CLAVE = 'ClaveCorrecta12345'
const CLAVE_MALA = 'ClaveEquivocada9876'

describe('V22: enumeracion de usuarios en el login', () => {
  let getModel
  let seq = 0

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    await seedRoles(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    jest.restoreAllMocks()
  })

  async function crearUsuario({ estado = true, lockedUntil = null } = {}) {
    const n = ++seq
    const correo = `usuario-${n}@ecora.cl`
    const user = await createTestUser(getModel, {
      username: `usuario-${n}`, correo, password: CLAVE, roles: ['TRABAJADOR'],
    })
    if (estado === false || lockedUntil) {
      await user.update({ estado, lockedUntil })
    }
    return { user, correo }
  }

  const entrar = (correo, password) =>
    request(app).post('/api/auth/login').send({ correo, password })

  const enUnaHora = () => new Date(Date.now() + 60 * 60 * 1000)

  // ────────────────────────────────────────────────────────────────
  // Sin la contraseña correcta, todo responde igual
  // ────────────────────────────────────────────────────────────────

  describe('respuestas sin credencial valida', () => {
    it('una cuenta bloqueada responde igual que un correo inexistente', async () => {
      const { correo } = await crearUsuario({ lockedUntil: enUnaHora() })

      const bloqueada = await entrar(correo, CLAVE_MALA)
      const inexistente = await entrar('no-existe@ecora.cl', CLAVE_MALA)

      expect(bloqueada.status).toBe(inexistente.status)
      expect(bloqueada.body).toEqual(inexistente.body)
    })

    it('una cuenta deshabilitada responde igual que un correo inexistente', async () => {
      const { correo } = await crearUsuario({ estado: false })

      const deshabilitada = await entrar(correo, CLAVE_MALA)
      const inexistente = await entrar('tampoco-existe@ecora.cl', CLAVE_MALA)

      expect(deshabilitada.status).toBe(inexistente.status)
      expect(deshabilitada.body).toEqual(inexistente.body)
    })

    it('una cuenta normal con clave equivocada responde igual que un correo inexistente', async () => {
      const { correo } = await crearUsuario()

      const claveMala = await entrar(correo, CLAVE_MALA)
      const inexistente = await entrar('nadie@ecora.cl', CLAVE_MALA)

      expect(claveMala.status).toBe(inexistente.status)
      expect(claveMala.body).toEqual(inexistente.body)
    })

    it('las cuatro situaciones dan exactamente el mismo 401', async () => {
      const bloqueada = await crearUsuario({ lockedUntil: enUnaHora() })
      const deshabilitada = await crearUsuario({ estado: false })
      const normal = await crearUsuario()

      const respuestas = [
        await entrar(bloqueada.correo, CLAVE_MALA),
        await entrar(deshabilitada.correo, CLAVE_MALA),
        await entrar(normal.correo, CLAVE_MALA),
        await entrar('inexistente@ecora.cl', CLAVE_MALA),
      ]

      for (const res of respuestas) {
        expect(res.status).toBe(401)
        expect(res.body).toEqual(respuestas[0].body)
      }
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Con la contraseña correcta si se informa el estado
  // ────────────────────────────────────────────────────────────────

  describe('respuestas con la credencial correcta', () => {
    // La informacion sobre el estado de la cuenta se entrega solo a quien
    // demostro ser su dueño. Es mas util que antes, no menos.
    it('la cuenta bloqueada informa el bloqueo y hasta cuando', async () => {
      const { correo } = await crearUsuario({ lockedUntil: enUnaHora() })

      const res = await entrar(correo, CLAVE)

      expect(res.status).toBe(423)
      expect(res.body.lockedUntil).toBeDefined()
    })

    it('la cuenta deshabilitada informa que lo esta', async () => {
      const { correo } = await crearUsuario({ estado: false })

      const res = await entrar(correo, CLAVE)

      expect(res.status).toBe(403)
    })

    it('la cuenta normal inicia sesion', async () => {
      const { correo } = await crearUsuario()

      const res = await entrar(correo, CLAVE)

      expect(res.status).toBe(200)
      expect(res.body.user.correo).toBe(correo)
    })

    // Aunque acierte la contraseña de una cuenta bloqueada, NO se emite sesion:
    // por eso comparar antes no debilita el lockout.
    it('la cuenta bloqueada no emite cookies de sesion ni con la clave correcta', async () => {
      const { correo } = await crearUsuario({ lockedUntil: enUnaHora() })

      const res = await entrar(correo, CLAVE)

      const cookies = res.headers['set-cookie'] || []
      expect(cookies.some(c => c.startsWith('__access_token='))).toBe(false)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Timing: comprobacion estructural, no de reloj
  // ────────────────────────────────────────────────────────────────

  describe('coste uniforme entre existir y no existir', () => {
    // Se comprueba que bcrypt se ejecute TAMBIEN sin usuario, en vez de medir
    // milisegundos: un test de reloj da falsos rojos en una maquina cargada y
    // termina erosionando la confianza en toda la suite. Esta version detecta
    // igual la regresion que importa, que es volver a salir antes de comparar.
    // Se espia bcryptjs y no utils/hash porque el controlador desestructura
    // `compare` al cargar el modulo, asi que un espia sobre ese objeto no
    // intercepta la referencia que ya capturo. bcrypt si se resuelve en cada
    // llamada.
    it('compara la contraseña aunque el correo no exista', async () => {
      const espia = jest.spyOn(bcrypt, 'compare')

      await entrar('fantasma@ecora.cl', CLAVE_MALA)

      expect(espia).toHaveBeenCalled()
    })

    it('compara la contraseña aunque la cuenta este bloqueada', async () => {
      const { correo } = await crearUsuario({ lockedUntil: enUnaHora() })
      const espia = jest.spyOn(bcrypt, 'compare')

      await entrar(correo, CLAVE_MALA)

      expect(espia).toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────
  // El lockout sigue funcionando
  // ────────────────────────────────────────────────────────────────

  describe('lockout', () => {
    it('sigue bloqueando la cuenta tras cinco intentos fallidos', async () => {
      const { user, correo } = await crearUsuario()

      for (let i = 0; i < 5; i++) await entrar(correo, CLAVE_MALA)

      await user.reload()
      expect(user.lockedUntil).toBeTruthy()
    })

    it('un intento fallido contra un correo inexistente no crea nada', async () => {
      const antes = await getModel('Usuario').count()

      await entrar('otro-fantasma@ecora.cl', CLAVE_MALA)

      expect(await getModel('Usuario').count()).toBe(antes)
    })
  })
})
