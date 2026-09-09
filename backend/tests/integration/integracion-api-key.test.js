// backend/tests/integration/integracion-api-key.test.js
// V3 y B3: como se recibe y se compara la API key de integracion.
//
// V3 — la llave se acepta por query string ademas de por cabecera. Por query
// queda escrita en los access logs del proxy, en morgan y en el requestLogger, y
// viaja en la cabecera Referer. Es lo mismo que este backend ya evita para el
// JWT: middleware/auth.js lo dice en un comentario y el commit a775580 lo
// elimino a conciencia. La via por query se elimina en cuanto se confirme que
// ningun consumidor real la usa; mientras tanto queda instrumentada.
//
// B3 — la comparacion usaba !== , que sale en cuanto encuentra el primer byte
// distinto. Ahora es en tiempo constante.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles } = require('../helpers/auth')

const LLAVE = 'llave-de-integracion-para-pruebas-0123456789'

describe('API key de integracion', () => {
  let getModel
  let referido
  const original = process.env.INTEGRACION_API_KEY

  beforeAll(async () => {
    process.env.INTEGRACION_API_KEY = LLAVE
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    await seedRoles(getModel)
  })

  afterAll(async () => {
    if (original === undefined) delete process.env.INTEGRACION_API_KEY
    else process.env.INTEGRACION_API_KEY = original
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    const Usuario = getModel('Usuario')
    const creador = await Usuario.create({
      username: 'creador-int', correo: 'creador-int@ecora.cl', estado: true, auth_provider: 'local',
    })
    referido = await getModel('Referido').create({
      nombre: 'CANDIDATO INTEGRACION', estado: 'APROBADO', creadoPorUserId: creador.id,
    })
  })

  const informar = (cabeceras = {}, query = '') =>
    request(app)
      .patch(`/api/integracion/${referido.id}/resultado-reclutamiento${query}`)
      .set(cabeceras)
      .send({ resultado: 'CONTRATADO' })

  describe('via de entrega de la llave', () => {
    it('acepta la llave por cabecera x-api-key', async () => {
      const res = await informar({ 'x-api-key': LLAVE })

      expect(res.status).toBe(200)
    })

    it('rechaza una llave incorrecta', async () => {
      const res = await informar({ 'x-api-key': 'llave-que-no-es-la-correcta-000000000000000' })

      expect(res.status).toBe(401)
    })

    it('rechaza cuando no se envia llave', async () => {
      const res = await informar()

      expect(res.status).toBe(401)
    })

    // La via por query sigue funcionando a proposito mientras se confirma si
    // algun consumidor real la usa. Cuando se elimine, este caso pasa a esperar
    // 401 y sera la señal de que el corte se aplico.
    it('todavia acepta la llave por query string, y lo registra como en desuso', async () => {
      const avisos = []
      const original = console.warn
      console.warn = (...args) => { avisos.push(args.join(' ')) }
      try {
        const res = await informar({}, `?api_key=${encodeURIComponent(LLAVE)}`)

        expect(res.status).toBe(200)
        const aviso = avisos.find(a => a.includes('api key por query string (en desuso)'))
        expect(aviso).toBeDefined()
        // El aviso NO puede contener la llave ni un fragmento suyo: seria
        // escribir en el log justo lo que se quiere sacar del log.
        expect(aviso).not.toContain(LLAVE)
        expect(aviso).not.toContain(LLAVE.slice(0, 8))
      } finally {
        console.warn = original
      }
    })

    it('no registra el aviso cuando la llave llega por cabecera', async () => {
      const avisos = []
      const original = console.warn
      console.warn = (...args) => { avisos.push(args.join(' ')) }
      try {
        await informar({ 'x-api-key': LLAVE })

        expect(avisos.find(a => a.includes('en desuso'))).toBeUndefined()
      } finally {
        console.warn = original
      }
    })
  })

  describe('comparacion de la llave (B3)', () => {
    it('no acepta una llave que solo comparte el prefijo', async () => {
      const res = await informar({ 'x-api-key': LLAVE.slice(0, -1) + 'X' })

      expect(res.status).toBe(401)
    })

    it('no lanza cuando la llave recibida tiene otra longitud', async () => {
      // timingSafeEqual lanza si los buffers difieren en tamaño: la comparacion
      // de longitud tiene que ir antes.
      const res = await informar({ 'x-api-key': 'corta' })

      expect(res.status).toBe(401)
    })
  })
})
