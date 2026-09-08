// backend/src/controllers/persona.controller.js
const { body, param, validationResult } = require('express-validator')
const { wrapHandlers } = require('../lib/asyncHandler')
const { getModel } = require('../db')

const Persona = getModel('Persona')

const createValidators = [
  body('nombres').isString().notEmpty(),
  body('apellidos').isString().notEmpty(),
  body('rut').optional().isString(),
  body('telefono').optional().isString(),
  body('email').optional().isEmail(),
  body('direccion').optional().isString(),
  body('fecha_nacimiento').optional().isISO8601().toDate(),
  body('usuarioId').optional().isInt({ gt: 0 }),
]
async function create(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const row = await Persona.create(req.body)
  res.status(201).json(row)
}

async function list(_req, res) {
  const data = await Persona.findAll({ order: [['id','DESC']] })
  res.json(data)
}

const getValidators = [ param('id').isInt({ gt: 0 }) ]
async function getById(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Persona.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  res.json(row)
}

const updateValidators = [ param('id').isInt({ gt: 0 }), ...createValidators ]
async function update(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Persona.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  await row.update(req.body)
  res.json(row)
}

const removeValidators = [ param('id').isInt({ gt: 0 }) ]
async function remove(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const row = await Persona.findByPk(id)
  if (!row) return res.status(404).json({ error: 'No encontrado' })
  await row.destroy()
  res.json({ ok: true })
}

// wrapHandlers encadena el rechazo de cada handler async a next(): sin esto
// un fallo de base deja la peticion colgada en vez de responder 500.
module.exports = wrapHandlers({
  create, createValidators, list, getById, getValidators, update, updateValidators, remove, removeValidators
})
