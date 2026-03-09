// src/db/loadModels.js
const fs = require('fs')
const path = require('path')
const { DataTypes } = require('sequelize')

function loadModels(sequelize, modelsDir = path.join(__dirname, 'models')) {
  const models = {}
  if (!fs.existsSync(modelsDir)) return models

  const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js') && f !== 'index.js')
  for (const file of files) {
    const def = require(path.join(modelsDir, file))
    if (typeof def !== 'function') continue
    const model = def(sequelize, DataTypes)
    if (!model?.name) continue
    models[model.name] = model
  }
  return models
}

module.exports = { loadModels }
