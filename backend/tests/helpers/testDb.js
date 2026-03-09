// backend/tests/helpers/testDb.js
// Base de datos SQLite en memoria para testing
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const { loadModels } = require('../../src/db/loadModels');
const associate = require('../../src/db/associate');
const modelMap = require('../../src/db/modelMap');

/**
 * Convierte atributos ENUM a STRING para compatibilidad con SQLite.
 * SQLite no soporta el tipo ENUM nativo de PostgreSQL.
 */
function patchEnumAttributes(models) {
  for (const modelName of Object.keys(models)) {
    const model = models[modelName];
    const attrs = model.rawAttributes || model.tableAttributes;
    if (!attrs) continue;

    for (const [attrName, attrDef] of Object.entries(attrs)) {
      // Detectar ENUM por key del tipo o por instancia
      const typeName = attrDef.type?.key || attrDef.type?.constructor?.name || '';
      if (typeName === 'ENUM' || attrDef.type instanceof DataTypes.ENUM) {
        // Reemplazar ENUM con STRING, preservando las demas opciones
        attrDef.type = DataTypes.STRING;
        model.rawAttributes[attrName] = attrDef;
      }
    }

    // Forzar refresh de los atributos internos
    model.refreshAttributes();
  }
}

/**
 * Inicializa la base de datos de testing con SQLite :memory:.
 * Carga todos los modelos, aplica asociaciones y sincroniza con force:true.
 *
 * @returns {{ sequelize: Sequelize, models: Object, getModel: Function }}
 */
async function initTestDb() {
  const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: ':memory:',
    logging: false,
    define: {
      freezeTableName: false,
    },
  });

  // Cargar modelos desde el directorio real
  const modelsDir = path.join(__dirname, '..', '..', 'src', 'db', 'models');
  const models = loadModels(sequelize, modelsDir);

  // Parchar ENUMs antes de sincronizar (SQLite no soporta ENUM)
  patchEnumAttributes(models);

  // Aplicar asociaciones
  associate(models);

  // Crear tablas en memoria
  await sequelize.sync({ force: true });

  // Construir getModel usando el modelMap real (mismo comportamiento que produccion)
  function getModel(alias) {
    const candidates = modelMap[alias] || [alias];
    for (const name of candidates) {
      if (models[name]) return models[name];
    }
    throw new Error(
      `[testDb] No se encontro un modelo para alias "${alias}". Revisa src/db/modelMap.js`
    );
  }

  return { sequelize, models, getModel };
}

/**
 * Cierra la conexion de la base de datos de testing.
 */
async function closeTestDb(sequelize) {
  if (sequelize) {
    await sequelize.close();
  }
}

/**
 * Trunca todas las tablas (reset rapido sin recrear esquema).
 */
async function resetTestDb(sequelize) {
  if (!sequelize) return;

  // SQLite no soporta TRUNCATE, usamos DELETE FROM + reset autoincrement
  const models = sequelize.models;
  for (const modelName of Object.keys(models)) {
    await models[modelName].destroy({ where: {}, force: true });
  }
}

module.exports = { initTestDb, closeTestDb, resetTestDb };
