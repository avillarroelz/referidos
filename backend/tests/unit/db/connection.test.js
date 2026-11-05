// Cableado de la clave en la conexión real de Sequelize: lo único simulado es
// Secrets Manager y el connect del driver de Postgres (no hay base en los tests).
const mockSend = jest.fn()
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
  GetSecretValueCommand: jest.fn((input) => ({ input }))
}))

const secreto = (password) => ({ SecretString: JSON.stringify({ username: 'u', password }) })
const errorAuth = () => Object.assign(new Error('password authentication failed'), { parent: { code: '28P01' } })

let pgConnect
let sequelize

beforeEach(() => {
  mockSend.mockReset()
  jest.isolateModules(() => {
    // Se espía dentro del mismo registro de módulos y antes de cargar connection.js:
    // el envoltorio captura el connect al cargarse
    const PgConnectionManager = require('sequelize/lib/dialects/postgres/connection-manager')
    pgConnect = jest.spyOn(PgConnectionManager.prototype, 'connect')
    const { config } = require('../../../src/config')
    config.db.pass = 'clave-env'
    config.db.secretArn = 'arn:aws:secretsmanager:sa-east-1:1:secret:rds!db-x'
    config.db.secretTtlMs = 60 * 60 * 1000
    ;({ sequelize } = require('../../../src/db/connection'))
  })
})

afterEach(() => jest.restoreAllMocks())

// Abre una conexión por el mismo camino que usa el pool
const conectar = () => sequelize.connectionManager._connect({ ...sequelize.config })

test('cada conexión usa la clave de Secrets Manager, no DB_PASS', async () => {
  mockSend.mockResolvedValueOnce(secreto('clave-secreto'))
  pgConnect.mockResolvedValue({})

  await conectar()

  expect(pgConnect).toHaveBeenCalledTimes(1)
  expect(pgConnect.mock.calls[0][0].password).toBe('clave-secreto')
})

test('tras una rotación (28P01) relee el secreto y la misma conexión entra con la clave nueva', async () => {
  mockSend
    .mockResolvedValueOnce(secreto('clave-vieja'))
    .mockResolvedValueOnce(secreto('clave-nueva'))
  // Se anota la clave al momento de cada intento: el reintento reutiliza el mismo cfg
  const intentos = []
  pgConnect
    .mockImplementationOnce(async (cfg) => { intentos.push(cfg.password); throw errorAuth() })
    .mockImplementationOnce(async (cfg) => { intentos.push(cfg.password); return {} })

  await expect(conectar()).resolves.toEqual({})

  expect(mockSend).toHaveBeenCalledTimes(2)
  expect(intentos).toEqual(['clave-vieja', 'clave-nueva'])
})
