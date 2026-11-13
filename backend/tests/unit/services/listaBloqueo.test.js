// backend/tests/unit/services/listaBloqueo.test.js
// Servicio de verificación contra la lista de no recontratación (black), con
// respaldo local de huellas HMAC. El cliente se simula; la tabla es SQLite real.
const { createHmac } = require('node:crypto')

jest.mock('../../../src/services/listaBloqueoClient', () => ({
  ...jest.requireActual('../../../src/services/listaBloqueoClient'),
  consultarRut: jest.fn(),
  listarHuellas: jest.fn(),
  estaConfigurado: jest.fn(),
}))

const { config } = require('../../../src/config')
const db = require('../../../src/db')
const client = require('../../../src/services/listaBloqueoClient')
const servicio = require('../../../src/services/listaBloqueo')

const HUELLA_KEY = 'clave-de-huella-de-prueba'
const RUT = '12345678-5'
const RUT_PUNTOS = '12.345.678-5'
const huellaDe = (rut, key = HUELLA_KEY) => createHmac('sha256', key).update(rut).digest('hex')

describe('listaBloqueo (servicio)', () => {
  let Huella
  let salida

  beforeAll(async () => {
    await db.__initTestDb()
    Huella = db.getModel('ListaBloqueoHuella')
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    jest.restoreAllMocks()
    client.consultarRut.mockReset()
    client.listarHuellas.mockReset()
    client.estaConfigurado.mockReset().mockReturnValue(true)
    config.listaBloqueo = { url: 'https://black.test/api', apiKey: 'k', huellaKey: HUELLA_KEY }
    await Huella.destroy({ where: {} })
    salida = []
    for (const m of ['log', 'warn', 'error', 'info']) {
      jest.spyOn(console, m).mockImplementation((...a) => { salida.push(a.map(String).join(' ')) })
    }
  })

  afterEach(() => {
    delete config.listaBloqueo
  })

  it('exporta el texto fijo del rechazo', () => {
    expect(servicio.TEXTO_RECHAZO).toBe(
      'No se puede ingresar a esta persona: está en la lista de no recontratación. Contacta a Recursos Humanos.'
    )
  })

  describe('verificarRut', () => {
    it('sin configuración: sin_verificar y no llama a black', async () => {
      client.estaConfigurado.mockReturnValue(false)

      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'sin_verificar' })
      expect(client.consultarRut).not.toHaveBeenCalled()
    })

    it.each([[undefined], [null], [''], ['no es rut'], ['12345678-4'], [12345678]])(
      'RUT que no normaliza (%p): sin_verificar y no llama a black', async (crudo) => {
        await expect(servicio.verificarRut(crudo)).resolves.toEqual({ bloqueado: false, fuente: 'sin_verificar' })
        expect(client.consultarRut).not.toHaveBeenCalled()
      })

    it('black responde bloqueado: fuente black, consulta con el RUT normalizado', async () => {
      client.consultarRut.mockResolvedValue({ bloqueado: true })

      await expect(servicio.verificarRut(RUT_PUNTOS)).resolves.toEqual({ bloqueado: true, fuente: 'black' })
      expect(client.consultarRut).toHaveBeenCalledWith(RUT)
    })

    it('black responde no bloqueado: fuente black', async () => {
      client.consultarRut.mockResolvedValue({ bloqueado: false })
      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'black' })
    })

    it('black falla y la huella está en la tabla local: bloqueado por respaldo', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('timeout'))
      await Huella.create({ huella: huellaDe(RUT) })

      await expect(servicio.verificarRut(RUT_PUNTOS)).resolves.toEqual({ bloqueado: true, fuente: 'respaldo' })
    })

    it('black falla y la huella no está: no bloqueado por respaldo', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('http_500'))
      await Huella.create({ huella: huellaDe('11111111-1') })

      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'respaldo' })
    })

    it('black falla sin clave de huella: sin_verificar', async () => {
      config.listaBloqueo.huellaKey = ''
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('red'))
      await Huella.create({ huella: huellaDe(RUT) })

      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'sin_verificar' })
    })

    it('black falla y la búsqueda local también: sin_verificar, sin lanzar', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('red'))
      jest.spyOn(Huella, 'findByPk').mockRejectedValue(new Error('db caída'))

      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'sin_verificar' })
    })

    it('un error inesperado del cliente tampoco lanza', async () => {
      client.consultarRut.mockRejectedValue(new Error('algo raro'))
      await expect(servicio.verificarRut(RUT)).resolves.toEqual({ bloqueado: false, fuente: 'respaldo' })
    })

    it('al fallar black avisa con el tipo de falla y sin el RUT', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('timeout'))
      await Huella.create({ huella: huellaDe(RUT) })

      await servicio.verificarRut(RUT_PUNTOS)

      expect(console.warn).toHaveBeenCalled()
      const todo = salida.join('\n')
      expect(todo).toContain('timeout')
      expect(todo).not.toContain(RUT)
      expect(todo).not.toContain('12345678')
      expect(todo).not.toContain(huellaDe(RUT))
      expect(todo).not.toContain(HUELLA_KEY)
    })
  })

  describe('vector fijo de huella (no circular)', () => {
    // HMAC-SHA256(clave 'k' x32, '12345678-5'), calculado una vez con node -e
    const CLAVE_FIJA = 'k'.repeat(32)
    const HUELLA_FIJA = 'de94cae2d139f0594e594f5ec38a126884964360dbe8a154561ecd5883783257'

    it('con black caído, la huella literal cargada rechaza el RUT con puntos', async () => {
      config.listaBloqueo.huellaKey = CLAVE_FIJA
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('red'))
      await Huella.create({ huella: HUELLA_FIJA })

      await expect(servicio.verificarRut(RUT_PUNTOS)).resolves.toEqual({ bloqueado: true, fuente: 'respaldo' })
    })
  })

  describe('fallas 401/403 (clave inválida o revocada)', () => {
    it.each(['http_401', 'http_403'])('%s se registra con console.error y mensaje fijo, sin RUT ni clave', async (tipo) => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError(tipo))

      await servicio.verificarRut(RUT_PUNTOS)

      expect(console.error).toHaveBeenCalledTimes(1)
      const msg = console.error.mock.calls[0].join(' ')
      expect(msg).toContain('clave')
      expect(msg).not.toContain('12345678')
      expect(msg).not.toContain(HUELLA_KEY)
      expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('clave'))
    })

    it.each(['http_500', 'http_429', 'timeout', 'red'])('%s sigue en console.warn', async (tipo) => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError(tipo))

      await servicio.verificarRut(RUT)

      expect(console.warn).toHaveBeenCalled()
      expect(console.error).not.toHaveBeenCalled()
    })

    it('actualizarHuellas con 401 también usa console.error y conserva la tabla', async () => {
      await Huella.create({ huella: huellaDe('11111111-1') })
      client.listarHuellas.mockRejectedValue(new client.ListaBloqueoError('http_401'))

      await expect(servicio.actualizarHuellas()).resolves.toBeNull()

      expect(console.error).toHaveBeenCalledTimes(1)
      expect(console.error.mock.calls[0].join(' ')).toContain('clave')
      expect(await Huella.count()).toBe(1)
    })
  })

  describe('crearVerificador (cortacircuito por lote)', () => {
    it('tras la primera falla de black, el resto del lote usa solo el respaldo', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('timeout'))
      await Huella.create({ huella: huellaDe('22222222-2') })
      const verificar = servicio.crearVerificador()

      const r1 = await verificar('11111111-1')
      const r2 = await verificar('22222222-2')
      const r3 = await verificar('12.345.678-5')

      expect(client.consultarRut).toHaveBeenCalledTimes(1)
      expect(r1).toEqual({ bloqueado: false, fuente: 'respaldo' })
      expect(r2).toEqual({ bloqueado: true, fuente: 'respaldo' })
      expect(r3).toEqual({ bloqueado: false, fuente: 'respaldo' })
    })

    it('mientras black responde, consulta cada ítem', async () => {
      client.consultarRut.mockResolvedValue({ bloqueado: false })
      const verificar = servicio.crearVerificador()

      await verificar('11111111-1')
      await verificar('22222222-2')

      expect(client.consultarRut).toHaveBeenCalledTimes(2)
    })

    it('verificarRut suelto no comparte estado entre llamadas', async () => {
      client.consultarRut.mockRejectedValue(new client.ListaBloqueoError('red'))

      await servicio.verificarRut('11111111-1')
      await servicio.verificarRut('22222222-2')

      expect(client.consultarRut).toHaveBeenCalledTimes(2)
    })
  })

  describe('actualizarHuellas', () => {
    const H1 = huellaDe('11111111-1')
    const H2 = huellaDe('22222222-2')
    const H3 = huellaDe('33333333-3')
    const enTabla = async () => (await Huella.findAll({ raw: true })).map(h => h.huella).sort()

    it('reemplaza el contenido de la tabla y devuelve la cantidad cargada', async () => {
      await Huella.create({ huella: H1 })
      client.listarHuellas.mockResolvedValue([H2, H3])

      await expect(servicio.actualizarHuellas()).resolves.toBe(2)
      expect(await enTabla()).toEqual([H2, H3].sort())
    })

    it('tolera huellas repetidas en la respuesta', async () => {
      client.listarHuellas.mockResolvedValue([H2, H2, H3])

      await expect(servicio.actualizarHuellas()).resolves.toBe(2)
      expect(await enTabla()).toEqual([H2, H3].sort())
    })

    it('una lista vacía vacía la tabla', async () => {
      await Huella.create({ huella: H1 })
      client.listarHuellas.mockResolvedValue([])

      await expect(servicio.actualizarHuellas()).resolves.toBe(0)
      expect(await enTabla()).toEqual([])
    })

    it('si black falla conserva la tabla, avisa y devuelve null', async () => {
      await Huella.create({ huella: H1 })
      client.listarHuellas.mockRejectedValue(new client.ListaBloqueoError('http_500'))

      await expect(servicio.actualizarHuellas()).resolves.toBeNull()
      expect(await enTabla()).toEqual([H1])
      expect(console.warn).toHaveBeenCalled()
      expect(salida.join('\n')).toContain('http_500')
    })

    it('si la escritura falla a medias, la transacción deja la tabla como estaba', async () => {
      await Huella.create({ huella: H1 })
      client.listarHuellas.mockResolvedValue([H2, H3])
      jest.spyOn(Huella, 'bulkCreate').mockRejectedValue(new Error('disco lleno'))

      await expect(servicio.actualizarHuellas()).resolves.toBeNull()
      expect(await enTabla()).toEqual([H1])
    })

    it('sin configuración no hace nada', async () => {
      client.estaConfigurado.mockReturnValue(false)
      await Huella.create({ huella: H1 })

      await expect(servicio.actualizarHuellas()).resolves.toBeNull()
      expect(client.listarHuellas).not.toHaveBeenCalled()
      expect(await enTabla()).toEqual([H1])
    })

    it('sin clave de huella no hace nada', async () => {
      config.listaBloqueo.huellaKey = ''

      await expect(servicio.actualizarHuellas()).resolves.toBeNull()
      expect(client.listarHuellas).not.toHaveBeenCalled()
    })
  })
})
