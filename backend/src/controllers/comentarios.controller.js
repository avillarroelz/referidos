// backend/src/controllers/comentarios.controller.js
const { body, validationResult } = require('express-validator')
const { getModel } = require('../db')
const { notificarComentario } = require('../services/notificationService')
const { relacionesConReferido } = require('../lib/acceso')

const Comentario = () => getModel('Comentario')
const Referido = () => getModel('Referido')
const Usuario = () => getModel('Usuario')

// ──────────────────────────────────────────────────────────────
// Validadores

// Roles que pueden figurar en visibleParaRoles. Sin esta lista el cliente elige
// cualquier valor y puede dirigir un comentario a un rol inventado o inesperado.
const ROLES_VISIBILIDAD = ['TRABAJADOR', 'RRHH', 'JefeRRHH', 'ADMIN', 'ADC', 'EXTERNO']

// La ruta ya limita el ROL (RRHH, JefeRRHH, ADMIN, ADC); aca se comprueba la
// RELACION: privilegiado, o ADC pero solo el asignado a este referido. No se usa
// puedeAccederReferido porque dejaria pasar a un ADC por ser creador del referido.
function assertAccesoComentarios(req, res, referido) {
  const rel = relacionesConReferido(req.auth, referido)
  if (rel.privilegiado || rel.adcAsignado) return true
  res.status(403).json({ error: 'Sin permisos para ver o escribir comentarios de este referido' })
  return false
}

const crearValidators = [
  body('mensaje').isString().notEmpty().withMessage('mensaje es obligatorio'),
  body('visibleParaRoles')
    .optional()
    .isString()
    .custom((valor) => {
      const roles = valor.split(',').map(r => r.trim()).filter(Boolean)
      if (roles.length === 0) throw new Error('visibleParaRoles no puede ir vacío')
      const invalidos = roles.filter(r => !ROLES_VISIBILIDAD.includes(r))
      if (invalidos.length > 0) throw new Error(`Roles no válidos: ${invalidos.join(', ')}`)
      return true
    }),
]

// ──────────────────────────────────────────────────────────────
// Listar comentarios de un referido

async function listar(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const referidoId = Number(req.params.id)
  // JefeRRHH ve lo dirigido a RRHH: los comentarios existentes se guardaron con
  // 'RRHH,ADC,ADMIN' y asi se evita migrar filas.
  const userRoles = (req.auth.roles || []).flatMap(r => (r === 'JefeRRHH' ? ['JefeRRHH', 'RRHH'] : [r]))

  try {
    // El filtro por visibleParaRoles es visibilidad por ROL, no control de
    // acceso: sin esta guarda un ajeno lee los comentarios de cualquier
    // expediente cuya lista incluya su rol.
    const referido = await Referido().findByPk(referidoId)
    if (!referido) return res.status(404).json({ error: 'Referido no encontrado' })
    if (!assertAccesoComentarios(req, res, referido)) return

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
    if (!assertAccesoComentarios(req, res, referido)) return

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
