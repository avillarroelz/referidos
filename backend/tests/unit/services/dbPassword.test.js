// Clave de la base desde Secrets Manager con caché (la clave rota cada 7 días)
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: jest.fn((input) => ({ input }))
}))

const { config } = require('../../../src/config')
const dbPassword = require('../../../src/db/dbPassword')

const secreto = (password) => ({ SecretString: JSON.stringify({ username: 'u', password }) })

beforeEach(() => {
  mockSend.mockReset()
  dbPassword._reset()
  config.db.pass = 'clave-env'
  config.db.secretArn = undefined
  config.db.secretRegion = 'sa-east-1'
  config.db.secretTtlMs = 60 * 60 * 1000
})

afterEach(() => jest.restoreAllMocks())

describe('dbPassword', () => {
  test('(a) sin DB_SECRET_ARN usa DB_PASS y no llama a Secrets Manager', async () => {
    await expect(dbPassword.getDbPassword()).resolves.toBe('clave-env')
    expect(mockSend).not.toHaveBeenCalled()
  })

  test('(b) con DB_SECRET_ARN usa el password del secreto', async () => {
    config.db.secretArn = 'arn:aws:secretsmanager:sa-east-1:1:secret:db'
    mockSend.mockResolvedValue(secreto('clave-secreto'))
    await expect(dbPassword.getDbPassword()).resolves.toBe('clave-secreto')
    expect(mockSend.mock.calls[0][0].input.SecretId).toBe(config.db.secretArn)
  })

  test('(c) la segunda conexión usa el caché', async () => {
    config.db.secretArn = 'arn:x'
    mockSend.mockResolvedValue(secreto('v1'))
    await dbPassword.getDbPassword()
    await dbPassword.getDbPassword()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  test('(e) llamadas concurrentes generan una sola petición en vuelo', async () => {
    config.db.secretArn = 'arn:x'
    mockSend.mockImplementation(() => new Promise((r) => setTimeout(() => r(secreto('v1')), 20)))
    const res = await Promise.all([
      dbPassword.getDbPassword(),
      dbPassword.getDbPassword(),
      dbPassword.getDbPassword()
    ])
    expect(res).toEqual(['v1', 'v1', 'v1'])
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  test('(f) con el TTL vencido vuelve a leer', async () => {
    config.db.secretArn = 'arn:x'
    config.db.secretTtlMs = 1000
    mockSend.mockResolvedValueOnce(secreto('v1')).mockResolvedValueOnce(secreto('v2'))
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await expect(dbPassword.getDbPassword()).resolves.toBe('v1')
    now.mockReturnValue(1_000_500)
    await expect(dbPassword.getDbPassword()).resolves.toBe('v1')
    now.mockReturnValue(1_001_500)
    await expect(dbPassword.getDbPassword()).resolves.toBe('v2')
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  test('un fallo de Secrets Manager no queda cacheado', async () => {
    config.db.secretArn = 'arn:x'
    mockSend.mockRejectedValueOnce(new Error('throttled')).mockResolvedValueOnce(secreto('v1'))
    await expect(dbPassword.getDbPassword()).rejects.toThrow('throttled')
    await expect(dbPassword.getDbPassword()).resolves.toBe('v1')
  })

  test('con el TTL vencido y Secrets Manager caído sigue con la clave anterior', async () => {
    config.db.secretArn = 'arn:x'
    config.db.secretTtlMs = 1000
    mockSend.mockResolvedValueOnce(secreto('v1'))
      .mockRejectedValueOnce(new Error('caido'))
      .mockResolvedValueOnce(secreto('v2'))
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await dbPassword.getDbPassword()
    now.mockReturnValue(1_002_000)
    await expect(dbPassword.getDbPassword()).resolves.toBe('v1')
    // El respaldo no cuenta como lectura fresca: la siguiente vuelve a intentar
    await expect(dbPassword.getDbPassword()).resolves.toBe('v2')
  })

  describe('withAuthRetry (envoltorio de connect)', () => {
    const authErr = () => Object.assign(new Error('auth'), { parent: { code: '28P01' } })

    test('con el cfg compartido, la conexión que conectó con la clave vieja reintenta con la nueva', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('vieja')).mockResolvedValueOnce(secreto('nueva'))
      await dbPassword.getDbPassword()
      const cfg = { password: 'vieja' } // Sequelize pasa el mismo objeto a todas las conexiones
      let llamadas = 0
      const connect = jest.fn(async (c) => {
        llamadas++
        if (llamadas === 1) {
          // A sale con 'vieja'; mientras espera, B falla, renueva y deja 'nueva' en el cfg
          await envuelto(cfg)
          throw authErr()
        }
        if (c.password === 'vieja') throw authErr()
        return 'conn'
      })
      const envuelto = dbPassword.withAuthRetry(connect)
      await expect(envuelto(cfg)).resolves.toBe('conn')
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    test('si la relectura forzada falla, lanza el 28P01 original y no pierde la clave ni la ventana', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('vieja'))
        .mockRejectedValueOnce(new Error('caido'))
        .mockResolvedValueOnce(secreto('nueva'))
      await dbPassword.getDbPassword()
      const envuelto = dbPassword.withAuthRetry(jest.fn(async (c) => {
        if (c.password === 'vieja') throw authErr()
        return 'conn'
      }))
      await expect(envuelto({ password: 'vieja' })).rejects.toThrow('auth')
      // La clave anterior sigue en caché (otras conexiones no quedan sin clave)
      await expect(dbPassword.getDbPassword()).resolves.toBe('vieja')
      // La lectura fallida no consumió la ventana antirebote: el siguiente 28P01 relee
      await expect(envuelto({ password: 'vieja' })).resolves.toBe('conn')
    })

    test('(a) 28P01 y la segunda conexión funciona con la clave releída', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('vieja')).mockResolvedValueOnce(secreto('nueva'))
      const usadas = []
      const connect = jest.fn(async (cfg) => {
        usadas.push(cfg.password)
        if (cfg.password === 'vieja') throw authErr()
        return 'conn'
      })
      const cfg = { password: await dbPassword.getDbPassword() }
      await expect(dbPassword.withAuthRetry(connect)(cfg)).resolves.toBe('conn')
      expect(usadas).toEqual(['vieja', 'nueva'])
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    test('(b) 28P01 dos veces lanza, sin tercer intento', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValue(secreto('x'))
      const connect = jest.fn(async () => { throw authErr() })
      await expect(dbPassword.withAuthRetry(connect)({ password: 'x' })).rejects.toThrow('auth')
      expect(connect).toHaveBeenCalledTimes(2)
    })

    test('(c) otro error lanza sin reintentar ni invalidar', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValue(secreto('v1'))
      await dbPassword.getDbPassword()
      const connect = jest.fn(async () => { throw Object.assign(new Error('refused'), { parent: { code: 'ECONNREFUSED' } }) })
      await expect(dbPassword.withAuthRetry(connect)({ password: 'v1' })).rejects.toThrow('refused')
      expect(connect).toHaveBeenCalledTimes(1)
      await dbPassword.getDbPassword()
      expect(mockSend).toHaveBeenCalledTimes(1)
    })

    const conFallo = (malas) => jest.fn(async (cfg) => {
      if (malas.includes(cfg.password)) throw authErr()
      return 'conn'
    })

    test('(1a) conexión lenta con clave vieja: si el caché ya tiene otra, no relee', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('vieja')).mockResolvedValueOnce(secreto('nueva'))
      const connect = conFallo(['vieja'])
      const envuelto = dbPassword.withAuthRetry(connect)
      await dbPassword.getDbPassword()
      await envuelto({ password: 'vieja' }) // A renueva el caché
      await expect(envuelto({ password: 'vieja' })).resolves.toBe('conn') // B llega tarde
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    test('(1b) varias conexiones fallando a la vez provocan una sola lectura', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('vieja'))
      await dbPassword.getDbPassword()
      mockSend.mockImplementation(() => new Promise((r) => setTimeout(() => r(secreto('nueva')), 20)))
      const envuelto = dbPassword.withAuthRetry(conFallo(['vieja']))
      const res = await Promise.all([1, 2, 3].map(() => envuelto({ password: 'vieja' })))
      expect(res).toEqual(['conn', 'conn', 'conn'])
      expect(mockSend).toHaveBeenCalledTimes(2)
    })

    test('(1c) 28P01 persistente no relee más de una vez dentro de la ventana', async () => {
      config.db.secretArn = 'arn:x'
      mockSend.mockResolvedValueOnce(secreto('a')).mockResolvedValueOnce(secreto('b'))
        .mockResolvedValueOnce(secreto('c'))
      const now = jest.spyOn(Date, 'now')
      now.mockReturnValue(1_000_000)
      await dbPassword.getDbPassword()
      const envuelto = dbPassword.withAuthRetry(conFallo(['a', 'b', 'c']))
      await expect(envuelto({ password: 'a' })).rejects.toThrow('auth') // lee 'b' y falla
      await expect(envuelto({ password: 'b' })).rejects.toThrow('auth') // dentro de la ventana
      expect(mockSend).toHaveBeenCalledTimes(2)
      now.mockReturnValue(1_000_000 + 31_000)
      await expect(envuelto({ password: 'b' })).rejects.toThrow('auth') // ventana vencida: relee 'c'
      expect(mockSend).toHaveBeenCalledTimes(3)
    })
  })

  test('un secreto que no es JSON lanza mensaje fijo sin filtrar su contenido', async () => {
    config.db.secretArn = 'arn:x'
    mockSend.mockResolvedValue({ SecretString: 'super-secreto-plano' })
    const err = await dbPassword.getDbPassword().catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain('super-secreto-plano')
    expect(err.message).not.toContain('super')
  })
})
