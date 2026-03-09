// backend/src/controllers/comentarios.controller.js
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { notificarComentario } = require('../services/notificationService')

const Comentario = () => getModel('Comentario')
const Referido = () => getModel('Referido')
const Usuario = () => getModel('Usuario')

// ──────────────────────────────────────────────────────────────
// Validadores

const crearValidators = [
  body('mensaje').isString().notEmpty().withMessage('mensaje es obligatorio'),
  body('visibleParaRoles').optional().isString(),
]

// ──────────────────────────────────────────────────────────────
// Listar comentarios de un referido

async function listar(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const referidoId = Number(req.params.id)
  const userRoles = req.auth.roles || []

  try {
    const comentarios = await Comentario().findAll({
      where: { referidoId },
      include: [
        { model: Usuario(), as: 'autor', attributes: ['id', 'username', 'correo'] },
      ],
      order: [['id', 'ASC']],
    })

    // Filtrar por visibilidad de roles
    const visibles = comentarios.filter(c => {
      const rolesPermitidos = (c.visibleParaRoles || '').split(',').map(r => r.trim())
      return userRoles.some(r => rolesPermitidos.includes(r))
    })

    return res.json(visibles)
  } catch (err) {
    console.error(`[comentarios] listar FAIL`, err)
    return res.status(500).json({ error: 'No se pudieron obtener los comentarios' })
  }
}

// ──────────────────────────────────────────────────────────────
// Crear comentario

async function crear(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const referidoId = Number(req.params.id)

  try {
    const referido = await Referido().findByPk(referidoId)
    if (!referido) {
      return res.status(404).json({ error: 'Referido no encontrado' })
    }

    const comentario = await Comentario().create({
      referidoId,
      autorUserId: req.auth.id,
      mensaje: req.body.mensaje.trim(),
      visibleParaRoles: req.body.visibleParaRoles || 'RRHH,ADC,ADMIN',
    })

    // Obtener el usuario autor para el nombre
    const autor = await Usuario().findByPk(req.auth.id, { attributes: ['id', 'username'] })

    // Disparar notificación (no bloqueante)
    notificarComentario(referido, req.auth.id, autor?.username || 'Usuario').catch(err =>
      console.error('[comentarios] notificación FAIL:', err.message)
    )

    // Retornar con autor incluido
    const result = comentario.toJSON()
    result.autor = autor ? { id: autor.id, username: autor.username } : null

    return res.status(201).json(result)
  } catch (err) {
    console.error(`[comentarios] crear FAIL`, err)
    return res.status(500).json({ error: 'No se pudo crear el comentario' })
  }
}

module.exports = { listar, crear, crearValidators }
