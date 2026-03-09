// backend/src/db/index.js
const path = require('path')
const { sequelize } = require('./connection')
const { loadModels } = require('./loadModels')
const map = require('./modelMap')
const associate = require('./associate')

// 1) Carga todos los modelos definidos en backend/src/db/models/*.js
const modelsDir = path.join(__dirname, 'models')
const models = loadModels(sequelize, modelsDir)

// 2) Aplica asociaciones en un solo lugar (sin tocar tus modelos)
associate(models)

// 3) Helper para obtener un modelo por alias amigable
function getModel(alias) {
  const candidates = map[alias] || [alias]
  for (const name of candidates) {
    if (models[name]) return models[name]
  }
  throw new Error(`[models] No se encontró un modelo para alias "${alias}". Revisa src/db/modelMap.js`)
}

module.exports = { sequelize, models, getModel }
