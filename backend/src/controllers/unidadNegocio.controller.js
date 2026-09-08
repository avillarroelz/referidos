// backend/src/controllers/unidadNegocio.controller.js
const { body, param, query, validationResult } = require('express-validator')
const { wrapHandlers } = require('../lib/asyncHandler')
const { getModel } = require('../db')

const Unidad = getModel('UnidadNegocio')
const Linea = getModel('LineaNegocio')
const Usuario = getModel('Usuario')

const createValidators = [
  body('nombre').isString().notEmpty(),
  body('descripcion').optional().isString(),
  body('estado').optional().isBoolean(),
  body('lineaNegocioId').optional().isInt({ gt: 0 }),
]
async function create(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { nombre, descripcion = null, estado = true, lineaNegocioId = null } = req.body
  const exists = await Unidad.findOne({ where: { nombre } })
  if (exists) return res.status(409).json({ error: 'Nombre ya existe' })
  if (lineaNegocioId) {
    const ln = await Linea.findByPk(lineaNegocioId); if (!ln) return res.status(404).json({ error: 'Línea no encontrada' })
  }
  const r = await Unidad.create({ nombre, descripcion, estado, lineaNegocioId })
  res.status(201).json(r)
}

const listValidators = [ query('lineaNegocioId').optional().isInt({ gt: 0 }) ]
async function list(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { lineaNegocioId } = req.query
  const where = {}
  if (lineaNegocioId) where.lineaNegocioId = +lineaNegocioId
  const data = await Unidad.findAll({ where, order: [['id','ASC']] })
  res.json(data)
}

const updateValidators = [
  param('id').isInt({ gt: 0 }),
  body('nombre').isString().notEmpty(),
  body('descripcion').optional().isString(),
  body('estado').optional().isBoolean(),
  body('lineaNegocioId').optional().isInt({ gt: 0 }),
]
async function update(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Unidad.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  const { nombre, descripcion = null, estado = true, lineaNegocioId = null } = req.body
  await row.update({ nombre, descripcion, estado, lineaNegocioId })
  res.json(row)
}

const removeValidators = [ param('id').isInt({ gt: 0 }) ]
async function remove(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Unidad.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  await row.destroy()
  res.json({ ok: true })
}

const assignValidators = [
  param('usuarioId').isInt({ gt: 0 }),
  body('unidadNegocioId').isInt({ gt: 0 }),
]
async function assignUnidad(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { usuarioId } = req.params
  const { unidadNegocioId } = req.body

  const user = await Usuario.findByPk(usuarioId)
  const unidad = await Unidad.findByPk(unidadNegocioId)
  if (!user || !unidad) return res.status(404).json({ error: 'Usuario o Unidad no encontrado' })

  await user.addUnidadNegocio(unidad) // mixin del alias 'unidadNegocios'
  res.json({ ok: true })
}

const unassignValidators = [
  param('usuarioId').isInt({ gt: 0 }),
  body('unidadNegocioId').isInt({ gt: 0 }),
]
async function unassignUnidad(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { usuarioId } = req.params
  const { unidadNegocioId } = req.body

  const user = await Usuario.findByPk(usuarioId)
  const unidad = await Unidad.findByPk(unidadNegocioId)
  if (!user || !unidad) return res.status(404).json({ error: 'Usuario o Unidad no encontrado' })

  await user.removeUnidadNegocio(unidad)
  res.json({ ok: true })
}

// wrapHandlers encadena el rechazo de cada handler async a next(): sin esto
// un fallo de base deja la peticion colgada en vez de responder 500.
module.exports = wrapHandlers({
  create, createValidators, list, listValidators, update, updateValidators, remove, removeValidators,
  assignUnidad, assignValidators, unassignUnidad, unassignValidators
})
