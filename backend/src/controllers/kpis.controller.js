// backend/src/controllers/kpis.controller.js
const { QueryTypes, Op } = require('sequelize')
const { query, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS } = require('../lib/estados')

const Referido = getModel('Referido')

const rangeValidators = [
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  query('interval').optional().isIn(['day','week','month']),
]

function buildRange(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date()
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30*24*3600*1000)
  return { from, to }
}

/**
 * /kpis/overview
 * Conteo por estado + total en rango (por created_at de Referido)
 */
async function overview(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const rows = await Referido.findAll({
    attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('estado')), 'count']],
    where: { created_at: { [Op.between]: [from, to] } },
    group: ['estado']
  })

  const counts = Object.fromEntries(Object.values(ESTADOS).map(e => [e, 0]))
  let total = 0
  rows.forEach(r => { const c = Number(r.get('count')); counts[r.get('estado')] = c; total += c })

  res.json({ range: { from, to }, total, byEstado: counts })
}

/**
 * /kpis/series?interval=day|week|month
 * Serie temporal: creados y finalizados por periodo (created_at y historial hacia=FINALIZADO)
 */
async function series(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)
  const interval = req.query.interval || 'day'

  const createdSQL = `
    SELECT date_trunc(:interval, r.created_at) AS bucket, COUNT(*)::int AS created
    FROM referidos r
    WHERE r.created_at BETWEEN :from AND :to
    GROUP BY 1 ORDER BY 1
  `

  const finalizedSQL = `
    SELECT date_trunc(:interval, h.created_at) AS bucket, COUNT(*)::int AS finalized
    FROM estado_historial h
    WHERE h.hacia = 'FINALIZADO' AND h.created_at BETWEEN :from AND :to
    GROUP BY 1 ORDER BY 1
  `

  const [created, finalized] = await Promise.all([
    sequelize.query(createdSQL, { type: QueryTypes.SELECT, replacements: { from, to, interval } }),
    sequelize.query(finalizedSQL, { type: QueryTypes.SELECT, replacements: { from, to, interval } }),
  ])

  // merge left by bucket
  const map = new Map()
  created.forEach(r => map.set(String(r.bucket), { bucket: r.bucket, created: r.created, finalized: 0 }))
  finalized.forEach(r => {
    const k = String(r.bucket)
    if (!map.has(k)) map.set(k, { bucket: r.bucket, created: 0, finalized: r.finalized })
    else map.get(k).finalized = r.finalized
  })

  res.json({ range: { from, to }, interval, series: Array.from(map.values()) })
}

/**
 * /kpis/leadtime
 * Lead time promedio (horas) por transición usando ventana LEAD() sobre historial
 */
async function leadtime(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    WITH ordered AS (
      SELECT
        id, referido_id, actor_user_id, desde, hacia, created_at,
        LEAD(desde)  OVER (PARTITION BY referido_id ORDER BY id) AS next_desde,
        LEAD(hacia)  OVER (PARTITION BY referido_id ORDER BY id) AS next_hacia,
        LEAD(created_at) OVER (PARTITION BY referido_id ORDER BY id) AS next_ts
      FROM estado_historial
      WHERE created_at BETWEEN :from AND :to
    )
    SELECT
      desde, hacia, next_desde, next_hacia,
      AVG(EXTRACT(EPOCH FROM (next_ts - created_at))/3600.0) AS hours_avg,
      COUNT(*)::int AS n
    FROM ordered
    WHERE next_ts IS NOT NULL
    GROUP BY 1,2,3,4
    ORDER BY 1,2
  `
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, transitions: rows })
}

/**
 * /kpis/funnel
 * Conversiones desde LEIDO hacia RECHAZADO/ACREDITAR/RECLUTAMIENTO y cierres FINALIZADO
 */
async function funnel(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    SELECT
      SUM(CASE WHEN estado = 'PENDIENTE' THEN 1 ELSE 0 END)::int AS pendientes,
      SUM(CASE WHEN estado = 'LEIDO' THEN 1 ELSE 0 END)::int AS leidos,
      SUM(CASE WHEN estado = 'RECHAZADO' THEN 1 ELSE 0 END)::int AS rechazados,
      SUM(CASE WHEN estado = 'ACREDITAR' THEN 1 ELSE 0 END)::int AS acreditar,
      SUM(CASE WHEN estado = 'RECLUTAMIENTO' THEN 1 ELSE 0 END)::int AS reclutamiento,
      SUM(CASE WHEN estado = 'FINALIZADO' THEN 1 ELSE 0 END)::int AS finalizados
    FROM referidos
    WHERE created_at BETWEEN :from AND :to
  `
  const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, funnel: row })
}

module.exports = {
  overview, series, leadtime, funnel, rangeValidators
}
