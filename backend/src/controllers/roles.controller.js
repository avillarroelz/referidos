// backend/src/controllers/roles.controller.js
const { body, param, validationResult } = require('express-validator')
const { wrapHandlers } = require('../lib/asyncHandler')
const { getModel } = require('../db')
const { hash } = require('../utils/hash')

const Rol = getModel('Rol')
const Usuario = getModel('Usuario')

// Reglas de contraseña reutilizables (igual que el registro)
const passwordRules = (field) => body(field)
  .isString().isLength({ min: 12 }).withMessage('Contraseña mínimo 12 caracteres')
  .matches(/[A-Z]/).withMessage('Debe contener al menos una mayúscula')
  .matches(/[a-z]/).withMessage('Debe contener al menos una minúscula')
  .matches(/[0-9]/).withMessage('Debe contener al menos un número')

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

// ──────────────────────────────────────────────────────────────
// Gestión de usuarios (solo ADMIN)
// ──────────────────────────────────────────────────────────────

// Crear usuario interno con rol asignado
const createUsuarioValidators = [
  body('username').isString().trim().notEmpty().withMessage('Nombre requerido'),
  body('correo').isEmail().withMessage('Correo inválido').normalizeEmail(),
  passwordRules('password'),
  body('rolNombre').isString().notEmpty().withMessage('Rol requerido'),
]
async function createUsuario(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { username, correo, password, rolNombre } = req.body
  try {
    const correoNorm = correo.trim().toLowerCase()
    const exists = await Usuario.findOne({ where: { correo: correoNorm } })
    if (exists) return res.status(409).json({ error: 'El correo ya está registrado' })

    const rol = await Rol.findOne({ where: { nombre: rolNombre } })
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' })

    const passwordHashed = await hash(password)
    const user = await Usuario.create({
      username: username.trim(),
      correo: correoNorm,
      password: passwordHashed,
      estado: true,
      auth_provider: 'local',
    })
    await user.addRole(rol)

    return res.status(201).json({ id: user.id, username: user.username, correo: user.correo, estado: user.estado })
  } catch (e) {
    console.error('[roles] createUsuario FAIL', e)
    return res.status(500).json({ error: 'No se pudo crear el usuario' })
  }
}

// Editar datos del usuario (nombre, correo, estado habilitado/deshabilitado)
const updateUsuarioValidators = [
  param('id').isInt({ gt: 0 }),
  body('username').optional().isString().trim().notEmpty(),
  body('correo').optional().isEmail().normalizeEmail(),
  body('estado').optional().isBoolean(),
]
async function updateUsuario(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  try {
    const user = await Usuario.findByPk(id)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    // Un admin no puede deshabilitarse a sí mismo
    if (req.body.estado === false && id === req.auth?.id) {
      return res.status(400).json({ error: 'No puedes deshabilitar tu propia cuenta' })
    }

    const updates = {}
    if (req.body.username !== undefined) updates.username = String(req.body.username).trim()
    if (req.body.correo !== undefined) {
      const nuevoCorreo = String(req.body.correo).trim().toLowerCase()
      if (nuevoCorreo !== user.correo) {
        const dup = await Usuario.findOne({ where: { correo: nuevoCorreo } })
        if (dup) return res.status(409).json({ error: 'El correo ya está en uso' })
      }
      updates.correo = nuevoCorreo
    }
    if (req.body.estado !== undefined) updates.estado = !!req.body.estado

    await user.update(updates)
    return res.json({ ok: true, id: user.id, username: user.username, correo: user.correo, estado: user.estado })
  } catch (e) {
    console.error('[roles] updateUsuario FAIL', e)
    return res.status(500).json({ error: 'No se pudo actualizar el usuario' })
  }
}

// Restablecer la contraseña de un usuario (sin requerir la actual)
const resetUsuarioPasswordValidators = [
  param('id').isInt({ gt: 0 }),
  passwordRules('newPassword'),
]
async function resetUsuarioPassword(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const id = +req.params.id
  try {
    const user = await Usuario.findByPk(id)
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' })

    const hashed = await hash(req.body.newPassword)
    await user.update({ password: hashed })
    return res.json({ ok: true, message: 'Contraseña restablecida' })
  } catch (e) {
    console.error('[roles] resetUsuarioPassword FAIL', e)
    return res.status(500).json({ error: 'No se pudo restablecer la contraseña' })
  }
}

// wrapHandlers encadena el rechazo de cada handler async a next(): sin esto
// un fallo de base deja la peticion colgada en vez de responder 500.
module.exports = wrapHandlers({
  create, createValidators, list, listUsuarios, remove, removeValidators,
  assignRole, assignValidators, unassignRole, unassignValidators,
  createUsuario, createUsuarioValidators,
  updateUsuario, updateUsuarioValidators,
  resetUsuarioPassword, resetUsuarioPasswordValidators,
})
