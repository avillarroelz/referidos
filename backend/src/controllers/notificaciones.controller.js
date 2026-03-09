// backend/src/controllers/notificaciones.controller.js
const { getModel } = require('../db')
const { Op } = require('sequelize')

const Notificacion = () => getModel('Notificacion')

// ──────────────────────────────────────────────────────────────
// Listar notificaciones del usuario autenticado

async function listar(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const page = Number(req.query.page) || 1
  const limit = Number(req.query.limit) || 30
  const offset = (page - 1) * limit

  try {
    const { rows, count } = await Notificacion().findAndCountAll({
      where: { destinatarioUserId: req.auth.id },
      order: [['id', 'DESC']],
      limit,
      offset,
    })

    return res.json({ data: rows, total: count, page, limit })
  } catch (err) {
    console.error('[notificaciones] listar FAIL', err)
    return res.status(500).json({ error: 'No se pudieron obtener las notificaciones' })
  }
}

// ──────────────────────────────────────────────────────────────
// Contar no leídas

async function contarNoLeidas(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  try {
    const count = await Notificacion().count({
      where: { destinatarioUserId: req.auth.id, leida: false },
    })
    return res.json({ count })
  } catch (err) {
    console.error('[notificaciones] contarNoLeidas FAIL', err)
    return res.status(500).json({ error: 'Error al contar notificaciones' })
  }
}

// ──────────────────────────────────────────────────────────────
// Marcar una como leída

async function marcarLeida(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  try {
    const notif = await Notificacion().findOne({
      where: { id: Number(req.params.id), destinatarioUserId: req.auth.id },
    })

    if (!notif) return res.status(404).json({ error: 'Notificación no encontrada' })

    notif.leida = true
    notif.fechaLeida = new Date()
    await notif.save()

    return res.json({ ok: true })
  } catch (err) {
    console.error('[notificaciones] marcarLeida FAIL', err)
    return res.status(500).json({ error: 'No se pudo marcar como leída' })
  }
}

// ──────────────────────────────────────────────────────────────
// Marcar todas como leídas

async function marcarTodasLeidas(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  try {
    await Notificacion().update(
      { leida: true, fechaLeida: new Date() },
      { where: { destinatarioUserId: req.auth.id, leida: false } }
    )
    return res.json({ ok: true })
  } catch (err) {
    console.error('[notificaciones] marcarTodasLeidas FAIL', err)
    return res.status(500).json({ error: 'No se pudieron marcar como leídas' })
  }
}

module.exports = { listar, contarNoLeidas, marcarLeida, marcarTodasLeidas }
