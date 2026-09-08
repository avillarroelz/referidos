// backend/tests/setup.js
// Configura el entorno de testing antes de cada suite

// ── Variables de entorno para testing ──
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.DEBUG_TRANSITIONS = 'false';
process.env.DB_LOG = 'false';

// ── Mock de config (debe estar antes de cualquier require que use config) ──
jest.mock('../src/config', () => ({
  config: {
    port: 4000,
    nodeEnv: 'test',
    isProd: false,
    corsOrigin: '*',
    db: {
      host: 'localhost',
      port: 5432,
      user: 'test',
      pass: 'test',
      name: 'test_db',
      ssl: false,
      sslRejectUnauthorized: true,
      sslCaPath: null,
    },
    jwt: {
      secret: 'test-secret',
      expiresIn: '1h',
      refreshSecret: 'test-refresh-secret',
      refreshExpiresIn: '7d',
      algorithm: 'HS256',
    },
    auth: {
      internalEmailDomain: 'ecora.cl',
    },
    syncDb: false,
    seedAdmin: false,
    adminEmail: 'admin@test.local',
    adminPass: 'admin123',
    rateLimit: {
      windowMs: 15 * 60 * 1000,
      max: 1000,
    },
    sla: {
      adcResponseDays: 3,
    },
    publicForm: {
      rateLimitMax: 5,
    },
    anthropic: {
      apiKey: 'test-anthropic-key',
    },
  },
}));

// ── Mock de CSRF (los tests de integración no manejan el double-submit cookie) ──
jest.mock('csrf-csrf', () => ({
  doubleCsrf: () => ({
    generateCsrfToken: () => 'test-csrf-token',
    doubleCsrfProtection: (req, res, next) => next(),
  }),
}));

// ── Mock de rate limiters ──
// Se responde a CUALQUIER nombre de limitador con un passthrough. Enumerarlos a
// mano hacía que agregar uno nuevo en src/middleware/rateLimiters.js rompiera
// toda la suite de integración con un error que no lo menciona:
// "Route.post() requires a callback function but got a [object Undefined]".
jest.mock('../src/middleware/rateLimiters', () => {
  const passthrough = (req, res, next) => next();
  const noSonLimitadores = new Set(['__esModule', 'then', 'default', 'nodeType', 'toJSON']);
  return new Proxy(
    {},
    {
      get(target, prop) {
        if (typeof prop !== 'string' || noSonLimitadores.has(prop)) {
          return Reflect.get(target, prop);
        }
        return passthrough;
      },
      has(target, prop) {
        return typeof prop === 'string' && !noSonLimitadores.has(prop);
      },
    }
  );
});

// ── Mock de servicios externos ──
jest.mock('../src/services/googleAuthService', () => ({
  getAuthUrl: jest.fn(() => 'https://accounts.google.com/mock'),
  getTokensFromCode: jest.fn(),
  getUserInfo: jest.fn(),
}));

// ── Mock de la base de datos ──
// Inicialización síncrona con modelos reales en SQLite :memory:
jest.mock('../src/db', () => {
  const path = require('path');
  const { Sequelize, DataTypes } = require('sequelize');
  const { loadModels } = require('../src/db/loadModels');
  const associate = require('../src/db/associate');
  const modelMap = require('../src/db/modelMap');

  // Crear instancia SQLite sincrónicamente (la init real es asíncrona via sync)
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
  });

  // Cargar modelos
  const modelsDir = path.join(__dirname, '..', 'src', 'db', 'models');
  const models = loadModels(sequelize, modelsDir);

  // Parchar ENUMs → STRING para compatibilidad SQLite
  for (const modelName of Object.keys(models)) {
    const model = models[modelName];
    const attrs = model.rawAttributes || {};
    for (const [attrName, attrDef] of Object.entries(attrs)) {
      const typeName = attrDef.type?.key || attrDef.type?.constructor?.name || '';
      if (typeName === 'ENUM' || attrDef.type instanceof DataTypes.ENUM) {
        attrDef.type = DataTypes.STRING;
        model.rawAttributes[attrName] = attrDef;
      }
    }
    if (model.refreshAttributes) model.refreshAttributes();
  }

  // Aplicar asociaciones
  associate(models);

  // getModel con modelMap
  function getModel(alias) {
    const candidates = modelMap[alias] || [alias];
    for (const name of candidates) {
      if (models[name]) return models[name];
    }
    throw new Error(`[testDb] No se encontró modelo para alias "${alias}"`);
  }

  return {
    sequelize,
    models,
    getModel,
    __initTestDb: async () => {
      await sequelize.sync({ force: true });
      return { sequelize, models, getModel };
    },
    __closeTestDb: async () => {
      await sequelize.close();
    },
    __resetTestDb: async () => {
      // Desactivar FK constraints temporalmente para SQLite
      await sequelize.query('PRAGMA foreign_keys = OFF;');
      for (const modelName of Object.keys(models)) {
        try {
          await models[modelName].destroy({ where: {}, force: true, truncate: true });
        } catch (e) {
          // Ignorar errores de truncate en SQLite
        }
      }
      await sequelize.query('PRAGMA foreign_keys = ON;');
    },
  };
});
