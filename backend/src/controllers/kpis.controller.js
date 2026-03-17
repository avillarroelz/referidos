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
 * Serie temporal: creados y aprobados por periodo
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

  const approvedSQL = `
    SELECT date_trunc(:interval, h.created_at) AS bucket, COUNT(*)::int AS approved
    FROM estado_historial h
    WHERE h.hacia = 'APROBADO' AND h.created_at BETWEEN :from AND :to
    GROUP BY 1 ORDER BY 1
  `

  const [created, approved] = await Promise.all([
    sequelize.query(createdSQL, { type: QueryTypes.SELECT, replacements: { from, to, interval } }),
    sequelize.query(approvedSQL, { type: QueryTypes.SELECT, replacements: { from, to, interval } }),
  ])

  // merge left by bucket
  const map = new Map()
  created.forEach(r => map.set(String(r.bucket), { bucket: r.bucket, created: r.created, approved: 0 }))
  approved.forEach(r => {
    const k = String(r.bucket)
    if (!map.has(k)) map.set(k, { bucket: r.bucket, created: 0, approved: r.approved })
    else map.get(k).approved = r.approved
  })

  res.json({ range: { from, to }, interval, series: Array.from(map.values()) })
}

/**
 * /kpis/leadtime
 * Tiempo promedio de permanencia por transición (desde → hacia).
 * Usa LAG para calcular cuánto estuvo un referido en el estado "desde"
 * antes de pasar a "hacia".
 */
async function leadtime(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    WITH timed AS (
      SELECT
        referido_id, desde, hacia, created_at,
        LAG(created_at) OVER (PARTITION BY referido_id ORDER BY id) AS prev_ts
      FROM estado_historial
      WHERE created_at BETWEEN :from AND :to
    )
    SELECT
      desde,
      hacia,
      ROUND(AVG(EXTRACT(EPOCH FROM (created_at - prev_ts))/3600.0)::numeric, 1) AS hours_avg,
      COUNT(*)::int AS n
    FROM timed
    WHERE prev_ts IS NOT NULL
      AND desde <> hacia
    GROUP BY desde, hacia
    ORDER BY hours_avg DESC
  `
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, transitions: rows })
}

/**
 * /kpis/funnel
 * Conteo por cada uno de los 8 estados reales
 */
async function funnel(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    SELECT
      SUM(CASE WHEN estado = 'PENDIENTE'     THEN 1 ELSE 0 END)::int AS pendiente,
      SUM(CASE WHEN estado = 'EN_REVISION'   THEN 1 ELSE 0 END)::int AS "enRevision",
      SUM(CASE WHEN estado = 'ENVIADO_ADC'   THEN 1 ELSE 0 END)::int AS "enviadoAdc",
      SUM(CASE WHEN estado = 'VALIDADO_ADC'  THEN 1 ELSE 0 END)::int AS "validadoAdc",
      SUM(CASE WHEN estado = 'RECHAZADO_ADC' THEN 1 ELSE 0 END)::int AS "rechazadoAdc",
      SUM(CASE WHEN estado = 'CONTACTADO'    THEN 1 ELSE 0 END)::int AS contactado,
      SUM(CASE WHEN estado = 'APROBADO'      THEN 1 ELSE 0 END)::int AS aprobado,
      SUM(CASE WHEN estado = 'RECHAZADO'     THEN 1 ELSE 0 END)::int AS rechazado
    FROM referidos
    WHERE created_at BETWEEN :from AND :to
  `
  const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, funnel: row })
}

/**
 * /kpis/conversion-rate
 * Tasa de conversión y rechazo con delta respecto al período anterior
 */
async function conversionRate(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const rangeDuration = to.getTime() - from.getTime()
  const prevFrom = new Date(from.getTime() - rangeDuration)
  const prevTo = new Date(from.getTime())

  const sql = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE estado = 'APROBADO')::int  AS aprobados,
      COUNT(*) FILTER (WHERE estado = 'RECHAZADO')::int AS rechazados
    FROM referidos
    WHERE created_at BETWEEN :from AND :to
  `

  const [current, previous] = await Promise.all([
    sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } }),
    sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from: prevFrom, to: prevTo } }),
  ])

  const cur = current[0]
  const prev = previous[0]

  const conversionRate = cur.total > 0 ? (cur.aprobados / cur.total) * 100 : 0
  const rejectionRate = cur.total > 0 ? (cur.rechazados / cur.total) * 100 : 0
  const prevConversionRate = prev.total > 0 ? (prev.aprobados / prev.total) * 100 : 0
  const prevRejectionRate = prev.total > 0 ? (prev.rechazados / prev.total) * 100 : 0

  const inProcess = cur.total - cur.aprobados - cur.rechazados

  res.json({
    range: { from, to },
    total: cur.total,
    aprobados: cur.aprobados,
    rechazados: cur.rechazados,
    inProcess,
    conversionRate: +conversionRate.toFixed(2),
    rejectionRate: +rejectionRate.toFixed(2),
    delta: {
      conversion: +(conversionRate - prevConversionRate).toFixed(2),
      rejection: +(rejectionRate - prevRejectionRate).toFixed(2),
    }
  })
}

/**
 * /kpis/top-referrers
 * Top 10 usuarios que más referidos crearon en el período
 */
async function topReferrers(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    SELECT
      u.id,
      u.username           AS nombre,
      u.profile_picture    AS avatar,
      COUNT(*)::int        AS total,
      COUNT(*) FILTER (WHERE r.estado = 'APROBADO')::int AS aprobados,
      CASE WHEN COUNT(*) > 0
        THEN ROUND((COUNT(*) FILTER (WHERE r.estado = 'APROBADO')::numeric / COUNT(*)) * 100, 1)
        ELSE 0
      END AS tasa
    FROM referidos r
    JOIN usuarios u ON u.id = r.creado_por_usuario_id
    WHERE r.created_at BETWEEN :from AND :to
    GROUP BY u.id, u.username, u.profile_picture
    ORDER BY total DESC
    LIMIT 10
  `
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, referrers: rows })
}

/**
 * /kpis/by-unit
 * Referidos agrupados por unidad de negocio
 */
async function byUnit(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)

  const sql = `
    SELECT
      un.id,
      un.nombre,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE r.estado = 'APROBADO')::int  AS aprobados,
      COUNT(*) FILTER (WHERE r.estado = 'RECHAZADO')::int AS rechazados,
      COUNT(*) FILTER (WHERE r.estado NOT IN ('APROBADO','RECHAZADO'))::int AS en_proceso
    FROM referidos r
    JOIN unidad_negocio un ON un.id = r.unidad_negocio_id
    WHERE r.created_at BETWEEN :from AND :to
    GROUP BY un.id, un.nombre
    ORDER BY total DESC
  `
  const rows = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to } })
  res.json({ range: { from, to }, units: rows })
}

/**
 * /kpis/sla
 * % de referidos procesados dentro del SLA (72h default)
 */
async function sla(req, res) {
  const errors = validationResult(req); if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })
  const { from, to } = buildRange(req)
  const slaHours = Number(req.query.slaHours) || 72

  const sql = `
    WITH terminal AS (
      SELECT
        id,
        estado,
        EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600.0 AS hours
      FROM referidos
      WHERE estado IN ('APROBADO','RECHAZADO')
        AND created_at BETWEEN :from AND :to
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE hours <= :slaHours)::int AS within_sla,
      COUNT(*) FILTER (WHERE hours > :slaHours)::int  AS outside_sla,
      COALESCE(ROUND(AVG(hours)::numeric, 1), 0)      AS avg_hours
    FROM terminal
  `
  const [row] = await sequelize.query(sql, { type: QueryTypes.SELECT, replacements: { from, to, slaHours } })

  const compliance = row.total > 0 ? +((row.within_sla / row.total) * 100).toFixed(1) : 0

  res.json({
    range: { from, to },
    slaHours,
    total: row.total,
    withinSla: row.within_sla,
    outsideSla: row.outside_sla,
    avgHours: +row.avg_hours,
    compliance,
  })
}

module.exports = {
  overview, series, leadtime, funnel,
  conversionRate, topReferrers, byUnit, sla,
  rangeValidators
}
