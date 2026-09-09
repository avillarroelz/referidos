// backend/src/routes/integracion.routes.js
const crypto = require('crypto')
const router = require('express').Router()
const { body, param, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS, puedePasar } = require('../lib/estados')

/**
 * Compara en tiempo constante. timingSafeEqual exige buffers de igual longitud,
 * asi que la diferencia de largo se resuelve antes: eso filtra el LARGO de la
 * llave, no su contenido, y es un compromiso aceptado. No es un descuido.
 */
function mismaClave(recibida, esperada) {
  const a = Buffer.from(String(recibida))
  const b = Buffer.from(String(esperada))
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

// Middleware: autenticación por API Key
function requireApiKey(req, res, next) {
  const apiKey = process.env.INTEGRACION_API_KEY
  if (!apiKey) {
    console.error('[integracion] INTEGRACION_API_KEY no configurada')
    return res.status(503).json({ error: 'Integración no configurada' })
  }

  const porHeader = req.headers['x-api-key']
  const porQuery = req.query.api_key

  // La llave por query string queda escrita en los access logs del proxy, en
  // morgan, en el requestLogger y viaja en la cabecera Referer. Es exactamente
  // lo que este backend ya evita para el JWT (ver middleware/auth.js).
  //
  // Se sigue aceptando SOLO de forma transitoria: no consta en el repositorio
  // quien consume este endpoint ni por que via manda la llave, asi que cortarla
  // a ciegas podria romper una integracion en produccion. Este aviso permite
  // comprobarlo con datos: si no aparece en los logs de unos dias, la via por
  // query se elimina sin consultar a nadie.
  // El aviso NO incluye la llave ni ningun fragmento suyo: seria escribir en el
  // log justo lo que se quiere sacar de el.
  if (!porHeader && porQuery) {
    console.warn(`[integracion] api key por query string (en desuso) ip=${req.ip} ruta=${req.originalUrl.split('?')[0]}`)
  }

  const provided = porHeader || porQuery
  if (!provided || !mismaClave(provided, apiKey)) {
    console.warn('[integracion] API Key inválida o ausente')
    return res.status(401).json({ error: 'API Key inválida o no proporcionada' })
  }

  next()
}

const validators = [
  param('id').isInt({ gt: 0 }),
  body('resultado')
    .isString()
    .isIn(['CONTRATADO', 'NO_CONTRATADO'])
    .withMessage('resultado debe ser CONTRATADO o NO_CONTRATADO'),
  body('comentario').optional().isString(),
]

router.patch('/:id/resultado-reclutamiento', requireApiKey, validators, async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const t = await sequelize.transaction()
  try {
    const id = Number(req.params.id)
    const { resultado, comentario } = req.body

    const Referido = getModel('Referido')
    const EstadoHistorial = getModel('EstadoHistorial')

    const ref = await Referido.findByPk(id, { transaction: t })
    if (!ref) {
      await t.rollback()
      return res.status(404).json({ error: 'Referido no encontrado' })
    }

    if (ref.estado !== ESTADOS.APROBADO) {
      await t.rollback()
      return res.status(400).json({
        error: `No se puede marcar como ${resultado}: el referido debe estar en estado APROBADO (en proceso). Estado actual: ${ref.estado}`,
      })
    }

    if (!puedePasar(ref.estado, resultado)) {
      await t.rollback()
      return res.status(400).json({ error: `Transición no permitida: ${ref.estado} → ${resultado}` })
    }

    const estadoAnterior = ref.estado
    ref.estado = resultado
    await ref.save({ transaction: t })

    await EstadoHistorial.create({
      referidoId: id,
      desde: estadoAnterior,
      hacia: resultado,
      comentario: comentario || `Resultado informado por sistema de reclutamiento: ${resultado}`,
      actorUserId: null, // transición iniciada por sistema externo, sin usuario actor
    }, { transaction: t })

    await t.commit()

    console.log(`[integracion] Referido #${id}: ${estadoAnterior} → ${resultado}`)
    res.json({ ok: true, id, estadoAnterior, estadoNuevo: resultado })

  } catch (err) {
    await t.rollback()
    console.error('[integracion] Error:', err)
    res.status(500).json({ error: 'Error interno al actualizar resultado' })
  }
})

module.exports = router
