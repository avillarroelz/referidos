// backend/tests/unit/services/listaBloqueoClient.test.js
// Cliente de black (lista de no recontratación). fetch se simula: nunca se
// llama a la API real.
const { config } = require('../../../src/config')
const client = require('../../../src/services/listaBloqueoClient')

const URL_BASE = 'https://black.test/api/lista'
const CLAVE = 'clave-secreta-de-prueba'
const RUT = '12345678-5'

function respuesta(status, cuerpo) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: { cancel: jest.fn(async () => {}) },
    json: jest.fn(async () => {
      if (cuerpo instanceof Error) throw cuerpo
      return cuerpo
    }),
  }
}

beforeEach(() => {
  config.listaBloqueo = { url: URL_BASE, apiKey: CLAVE, huellaKey: 'huella' }
  config.isProd = false
  global.fetch = jest.fn()
})

afterEach(() => {
  delete global.fetch
  delete config.listaBloqueo
})

describe('consultarRut', () => {
  it('pide GET {url}/{rut} con la clave, sin seguir redirecciones y con timeout', async () => {
    global.fetch.mockResolvedValue(respuesta(200, { bloqueado: false }))

    await client.consultarRut(RUT)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe(`${URL_BASE}/12345678-5`)
    expect(opts.headers['X-API-Key']).toBe(CLAVE)
    expect(opts.redirect).toBe('error')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(opts.method === undefined || opts.method === 'GET').toBe(true)
  })

  it('quita la barra final de la URL configurada', async () => {
    config.listaBloqueo.url = `${URL_BASE}/`
    global.fetch.mockResolvedValue(respuesta(200, { bloqueado: false }))

    await client.consultarRut(RUT)

    expect(global.fetch.mock.calls[0][0]).toBe(`${URL_BASE}/12345678-5`)
  })

  it('200 bloqueado:true → { bloqueado: true }', async () => {
    global.fetch.mockResolvedValue(respuesta(200, { bloqueado: true }))
    await expect(client.consultarRut(RUT)).resolves.toEqual({ bloqueado: true })
  })

  it('200 bloqueado:false → { bloqueado: false }', async () => {
    global.fetch.mockResolvedValue(respuesta(200, { bloqueado: false }))
    await expect(client.consultarRut(RUT)).resolves.toEqual({ bloqueado: false })
  })

  it('devuelve solo { bloqueado }: nunca nombre ni motivo', async () => {
    global.fetch.mockResolvedValue(
      respuesta(200, { bloqueado: true, nombre: 'PERSONA DE PRUEBA', motivo: 'MOTIVO SENSIBLE' })
    )

    const r = await client.consultarRut(RUT)

    expect(Object.keys(r)).toEqual(['bloqueado'])
    expect(JSON.stringify(r)).not.toMatch(/PERSONA DE PRUEBA|MOTIVO SENSIBLE/)
  })

  it.each([400, 401, 403, 404, 429, 500, 503])('estado %i → ListaBloqueoError', async (status) => {
    global.fetch.mockResolvedValue(respuesta(status, { bloqueado: false }))
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it('en un estado distinto de 200 descarta el cuerpo para no retener la conexión', async () => {
    const r = respuesta(500, {})
    global.fetch.mockResolvedValue(r)

    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
    expect(r.body.cancel).toHaveBeenCalledTimes(1)
  })

  it('si cancelar el cuerpo falla o no existe, sigue lanzando ListaBloqueoError', async () => {
    const r = respuesta(503, {})
    r.body.cancel.mockRejectedValue(new Error('ya cerrado'))
    global.fetch.mockResolvedValueOnce(r)
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)

    const sinCuerpo = respuesta(503, {})
    delete sinCuerpo.body
    global.fetch.mockResolvedValueOnce(sinCuerpo)
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it('200 con JSON inválido → ListaBloqueoError', async () => {
    global.fetch.mockResolvedValue(respuesta(200, new SyntaxError('Unexpected token')))
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it.each([
    ['cadena', { bloqueado: 'true' }],
    ['número', { bloqueado: 1 }],
    ['nulo', { bloqueado: null }],
    ['ausente', {}],
    ['cuerpo nulo', null],
    ['arreglo', []],
  ])('bloqueado no booleano (%s) → ListaBloqueoError', async (_n, cuerpo) => {
    global.fetch.mockResolvedValue(respuesta(200, cuerpo))
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it('timeout → ListaBloqueoError de tipo timeout', async () => {
    const e = new Error('The operation was aborted due to timeout')
    e.name = 'TimeoutError'
    global.fetch.mockRejectedValue(e)

    const err = await client.consultarRut(RUT).catch(x => x)

    expect(err).toBeInstanceOf(client.ListaBloqueoError)
    expect(err.tipo).toBe('timeout')
  })

  it('error de red → ListaBloqueoError', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client.consultarRut(RUT)).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it('el mensaje del error no contiene el RUT ni la clave, aunque fetch los filtre', async () => {
    global.fetch.mockRejectedValue(new TypeError(`fetch failed ${URL_BASE}/${RUT} key=${CLAVE}`))

    const err = await client.consultarRut(RUT).catch(x => x)

    expect(err).toBeInstanceOf(client.ListaBloqueoError)
    expect(`${err.message} ${err.tipo} ${err.stack}`).not.toContain(RUT)
    expect(`${err.message} ${err.tipo} ${err.stack}`).not.toContain(CLAVE)
    expect(err.cause).toBeUndefined()
  })

  it('el mensaje de un estado de error no contiene el RUT ni la clave', async () => {
    global.fetch.mockResolvedValue(respuesta(401, {}))

    const err = await client.consultarRut(RUT).catch(x => x)

    expect(err.message).not.toContain(RUT)
    expect(err.message).not.toContain(CLAVE)
  })
})

describe('listarHuellas', () => {
  const H1 = 'a'.repeat(64)
  const H2 = '0123456789abcdef'.repeat(4)

  it('pide GET {url} con la clave y devuelve el arreglo de huellas', async () => {
    global.fetch.mockResolvedValue(respuesta(200, { huellas: [H1, H2] }))

    const huellas = await client.listarHuellas()

    expect(huellas).toEqual([H1, H2])
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe(URL_BASE)
    expect(opts.headers['X-API-Key']).toBe(CLAVE)
    expect(opts.redirect).toBe('error')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('acepta una lista vacía', async () => {
    global.fetch.mockResolvedValue(respuesta(200, { huellas: [] }))
    await expect(client.listarHuellas()).resolves.toEqual([])
  })

  it.each([
    ['sin huellas', {}],
    ['huellas no es arreglo', { huellas: 'abc' }],
    ['huella corta', { huellas: ['a'.repeat(63)] }],
    ['huella larga', { huellas: ['a'.repeat(65)] }],
    ['huella en mayúscula', { huellas: ['A'.repeat(64)] }],
    ['huella no hex', { huellas: ['g'.repeat(64)] }],
    ['elemento no string', { huellas: [123] }],
    ['una mala entre buenas', { huellas: [H1, 'x', H2] }],
    ['cuerpo nulo', null],
  ])('cuerpo inesperado (%s) → ListaBloqueoError', async (_n, cuerpo) => {
    global.fetch.mockResolvedValue(respuesta(200, cuerpo))
    await expect(client.listarHuellas()).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it.each([401, 429, 500])('estado %i → ListaBloqueoError', async (status) => {
    global.fetch.mockResolvedValue(respuesta(status, {}))
    await expect(client.listarHuellas()).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })

  it('error de red → ListaBloqueoError', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'))
    await expect(client.listarHuellas()).rejects.toBeInstanceOf(client.ListaBloqueoError)
  })
})

describe('estaConfigurado', () => {
  const con = (parcial) => { config.listaBloqueo = { url: URL_BASE, apiKey: CLAVE, huellaKey: '', ...parcial } }

  it('true con URL https y clave', () => {
    con({})
    expect(client.estaConfigurado()).toBe(true)
  })

  it('false sin URL, sin clave o sin sección de configuración', () => {
    con({ url: '' })
    expect(client.estaConfigurado()).toBe(false)
    con({ apiKey: '' })
    expect(client.estaConfigurado()).toBe(false)
    delete config.listaBloqueo
    expect(client.estaConfigurado()).toBe(false)
  })

  it('false si la URL no es https en producción', () => {
    config.isProd = true
    con({ url: 'http://black.test/api' })
    expect(client.estaConfigurado()).toBe(false)
    con({ url: 'http://127.0.0.1:4100/api' })
    expect(client.estaConfigurado()).toBe(false)
    con({ url: 'http://localhost:4100/api' })
    expect(client.estaConfigurado()).toBe(false)
  })

  it('fuera de producción permite http solo a 127.0.0.1 y localhost', () => {
    con({ url: 'http://127.0.0.1:4100/api' })
    expect(client.estaConfigurado()).toBe(true)
    con({ url: 'http://localhost:4100/api' })
    expect(client.estaConfigurado()).toBe(true)
    con({ url: 'http://black.test/api' })
    expect(client.estaConfigurado()).toBe(false)
    con({ url: 'http://localhost.evil.com/api' })
    expect(client.estaConfigurado()).toBe(false)
    con({ url: 'ftp://black.test/api' })
    expect(client.estaConfigurado()).toBe(false)
  })
})
