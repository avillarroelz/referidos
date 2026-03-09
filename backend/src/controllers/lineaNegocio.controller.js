// backend/src/controllers/lineaNegocio.controller.js
const { body, param, validationResult } = require('express-validator')
const { getModel } = require('../db')

const Linea = getModel('LineaNegocio')

const upsertValidators = [
  body('nombre').isString().notEmpty(),
  body('descripcion').optional().isString(),
  body('estado').optional().isBoolean(),
]
async function create(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { nombre, descripcion = null, estado = true } = req.body
  const exists = await Linea.findOne({ where: { nombre } })
  if (exists) return res.status(409).json({ error: 'Nombre ya existe' })
  const r = await Linea.create({ nombre, descripcion, estado })
  res.status(201).json(r)
}

async function list(_req, res) { res.json(await Linea.findAll({ order: [['id','ASC']] })) }

const updateValidators = [ param('id').isInt({ gt: 0 }), ...upsertValidators ]
async function update(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Linea.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  const { nombre, descripcion = null, estado = true } = req.body
  await row.update({ nombre, descripcion, estado })
  res.json(row)
}

const removeValidators = [ param('id').isInt({ gt: 0 }) ]
async function remove(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Linea.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  await row.destroy()
  res.json({ ok: true })
}

module.exports = { create, list, update, remove, upsertValidators, updateValidators, removeValidators }
