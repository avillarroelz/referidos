// backend/src/controllers/roles.controller.js
const { body, param, validationResult } = require('express-validator')
const { getModel } = require('../db')

const Rol = getModel('Rol')
const Usuario = getModel('Usuario')

const createValidators = [ body('nombre').isString().notEmpty(), body('descripcion').optional().isString() ]
async function create(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { nombre, descripcion = null } = req.body
  const exists = await Rol.findOne({ where: { nombre } })
  if (exists) return res.status(409).json({ error: 'El rol ya existe' })
  const r = await Rol.create({ nombre, descripcion })
  res.status(201).json(r)
}

async function list(_req, res) { res.json(await Rol.findAll({ order: [['id','ASC']] })) }

async function listUsuarios(_req, res) {
  const usuarios = await Usuario.findAll({
    include: [{ association: 'roles' }],
    attributes: { exclude: ['password'] },
    order: [['id', 'ASC']]
  })
  res.json(usuarios)
}

const removeValidators = [ param('id').isInt({ gt: 0 }) ]
async function remove(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  const r = await Rol.findByPk(id)
  if (!r) return res.status(404).json({ error: 'No encontrado' })
  await r.destroy()
  res.json({ ok: true })
}

const assignValidators = [
  param('usuarioId').isInt({ gt: 0 }),
  body('rolNombre').isString().notEmpty()
]
async function assignRole(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { usuarioId } = req.params
  const { rolNombre } = req.body
  const user = await Usuario.findByPk(usuarioId)
  const rol = await Rol.findOne({ where: { nombre: rolNombre } })
  if (!user || !rol) return res.status(404).json({ error: 'Usuario o Rol no encontrado' })
  await user.addRole(rol)
  res.json({ ok: true })
}

const unassignValidators = [
  param('usuarioId').isInt({ gt: 0 }),
  body('rolNombre').isString().notEmpty()
]
async function unassignRole(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { usuarioId } = req.params
  const { rolNombre } = req.body
  const user = await Usuario.findByPk(usuarioId)
  const rol = await Rol.findOne({ where: { nombre: rolNombre } })
  if (!user || !rol) return res.status(404).json({ error: 'Usuario o Rol no encontrado' })
  await user.removeRole(rol)
  res.json({ ok: true })
}

module.exports = {
  create, createValidators, list, listUsuarios, remove, removeValidators,
  assignRole, assignValidators, unassignRole, unassignValidators
}
