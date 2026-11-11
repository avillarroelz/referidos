// backend/src/controllers/gmailBandeja.controller.js
// Módulo Gmail: registro de correos revisados, historial y restauración.
const { body, param, query, validationResult } = require('express-validator')
const { wrapHandlers } = require('../lib/asyncHandler')
const { getModel } = require('../db')
const gmailService = require('../services/gmailService')
const { detalleOGenerico } = require('../lib/detalleError')
const { guardarAdjuntosDeCorreo } = require('../services/gmailAdjuntos')
const { recortar, buscarCorreoRevisado } = require('../services/gmailRegistro')

const GmailCorreoRevisado = getModel('GmailCorreoRevisado')
const Usuario = getModel('Usuario')
const Referido = getModel('Referido')
const { ESTADOS } = GmailCorreoRevisado

const MESSAGE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

function assertValid(res, req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  return null
}

const MAX_ADJUNTO = 10 * 1024 * 1024

// Inicializa el singleton de gmailService con el token centralizado. Devuelve
// true si quedó listo; si no, ya respondió 400 (casilla sin conectar).
async function inicializarGmail(res) {
  const { getSyncRefreshToken } = require('./gmailController')
  const refreshToken = await getSyncRefreshToken()
  if (!refreshToken) {
    res.status(400).json({
      error: 'Gmail no configurado. Un administrador debe conectar el correo de sincronizacion.',
      requiresSetup: true,
    })
    return false
  }
  await gmailService.initialize({
    client_id: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI,
    refresh_token: refreshToken,
  })
  return true
}

// Errores de Gmail que tienen respuesta propia; null si no es uno de ellos.
function responderErrorGmail(res, err) {
  if (err.code === 401 || err.message?.includes('invalid_grant')) {
    // 424 y no 401: el cliente HTTP del frontend trata todo 401 como sesión vencida
    // (refresca y repite), y aquí lo vencido es el token de Gmail, no la sesión.
    return res.status(424).json({ error: 'Credenciales de Google inválidas o expiradas. Vuelve a autenticarte.', requiresAuth: true })
  }
  if (err.code === 404) {
    return res.status(404).json({ error: 'Correo no encontrado en Gmail' })
  }
  return null
}

// ──────────────────────────────────────────────────────────────
// Descartar

const descartarValidators = [
  body('correos').isArray({ min: 1, max: 100 }).withMessage('correos debe tener entre 1 y 100 elementos'),
  body('correos.*.messageId').isString().matches(MESSAGE_ID_RE).withMessage('messageId inválido'),
  body('correos.*.from').optional({ nullable: true }).isString(),
  body('correos.*.subject').optional({ nullable: true }).isString(),
]

async function descartar(req, res) {
  if (assertValid(res, req)) return

  const porId = new Map()
  for (const c of req.body.correos) {
    if (!porId.has(c.messageId)) porId.set(c.messageId, c)
  }

  const ids = [...porId.keys()]
  const existentes = await GmailCorreoRevisado.findAll({
    where: { gmailMessageId: ids },
    attributes: ['gmailMessageId'],
    raw: true,
  })
  const yaAnotados = new Set(existentes.map(e => e.gmailMessageId))
  const nuevos = ids.filter(id => !yaAnotados.has(id)).map(id => ({
    gmailMessageId: id,
    estado: ESTADOS.DESCARTADO,
    remitente: recortar(porId.get(id).from),
    asunto: recortar(porId.get(id).subject),
    revisadoPorUsuarioId: req.auth.id,
  }))

  // ignoreDuplicates: si otra request anotó el mismo correo entre el chequeo y
  // el insert, el UNIQUE lo descarta en silencio en vez de fallar.
  if (nuevos.length > 0) await GmailCorreoRevisado.bulkCreate(nuevos, { ignoreDuplicates: true })

  return res.json({ ok: true, descartados: nuevos.length })
}

// ──────────────────────────────────────────────────────────────
// Historial

const historialValidators = [
  query('estado').optional().isIn(Object.values(ESTADOS)),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('pageSize').optional().isInt({ min: 1, max: 100 }).toInt(),
]

async function historial(req, res) {
  if (assertValid(res, req)) return

  const page = req.query.page || 1
  const pageSize = req.query.pageSize || 20
  const where = req.query.estado ? { estado: req.query.estado } : {}

  const { rows, count } = await GmailCorreoRevisado.findAndCountAll({
    where,
    include: [{ model: Usuario, as: 'revisadoPor', attributes: ['id', 'username'] }],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })

  return res.json({
    items: rows.map(r => ({
      messageId: r.gmailMessageId,
      estado: r.estado,
      remitente: r.remitente,
      asunto: r.asunto,
      referidoId: r.referidoId,
      revisadoPor: r.revisadoPor ? { id: r.revisadoPor.id, nombre: r.revisadoPor.username } : null,
      fecha: r.created_at,
    })),
    total: count,
    page,
    pageSize,
  })
}

// ──────────────────────────────────────────────────────────────
// Restaurar un descartado

const restaurarValidators = [
  param('messageId').matches(MESSAGE_ID_RE).withMessage('messageId inválido'),
]

async function restaurar(req, res) {
  if (assertValid(res, req)) return

  const fila = await GmailCorreoRevisado.findOne({ where: { gmailMessageId: req.params.messageId } })
  if (!fila) return res.status(404).json({ error: 'Correo no encontrado en el registro' })
  // Un importado ya tiene ficha: borrarlo de aquí lo haría reaparecer por el correo.
  if (fila.estado !== ESTADOS.DESCARTADO) {
    return res.status(409).json({ error: 'El correo ya fue importado; no se puede restaurar' })
  }

  await fila.destroy()
  return res.json({ ok: true })
}

// ──────────────────────────────────────────────────────────────
// Vista previa de un adjunto (no persiste nada: baja de Gmail y responde)

const adjuntoValidators = [
  param('messageId').matches(MESSAGE_ID_RE).withMessage('messageId inválido'),
  param('index').isInt({ min: 0, max: 49 }).withMessage('index inválido'),
]

const esPdf = (a) => /pdf/i.test(a.mimeType || '') || /\.pdf$/i.test(a.filename || '')
const esTextoExtraible = (a) =>
  /\.(docx|txt)$/i.test(a.filename || '')
  || /^(application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain)$/i.test(a.mimeType || '')

async function adjunto(req, res) {
  if (assertValid(res, req)) return

  try {
    if (!await inicializarGmail(res)) return

    const email = await gmailService.getEmail(req.params.messageId)
    const partes = gmailService.getAllAttachmentParts(email.payload)
    const parte = partes[Number(req.params.index)]
    if (!parte) return res.status(404).json({ error: 'Adjunto no encontrado' })

    if (parte.size > MAX_ADJUNTO) return res.status(413).json({ error: 'El adjunto supera los 10 MB' })
    const pdf = esPdf(parte)
    if (!pdf && !esTextoExtraible(parte)) {
      return res.status(415).json({ error: 'Solo se pueden previsualizar PDF, Word (.docx) y texto' })
    }

    const buffer = await gmailService.downloadAttachment(req.params.messageId, parte.attachmentId)
    if (!buffer) return res.status(502).json({ error: 'No se pudo descargar el adjunto desde Gmail' })
    if (buffer.length > MAX_ADJUNTO) return res.status(413).json({ error: 'El adjunto supera los 10 MB' })

    // Cabeceras iguales para todo: el contenido viene de un tercero y se entrega
    // en nuestro origen, así que nunca se refleja su tipo ni su nombre.
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })

    if (pdf) {
      // El mimetype lo declara el remitente: se verifica la firma real del archivo.
      if (!buffer.subarray(0, 1024).includes('%PDF-')) {
        return res.status(415).json({ error: 'El archivo no es un PDF válido' })
      }
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="documento.pdf"' })
      return res.send(buffer)
    }

    const texto = await gmailService.extractTextFromFile(buffer, parte.filename, parte.mimeType)
    res.set('Content-Type', 'text/plain; charset=utf-8')
    return res.send(texto)
  } catch (err) {
    if (responderErrorGmail(res, err)) return
    console.error('[gmailBandeja] adjunto FAIL', err.message)
    return res.status(500).json({ error: detalleOGenerico(err, 'No se pudo obtener el adjunto') })
  }
}

// ──────────────────────────────────────────────────────────────
// Adjuntar los documentos de un correo a una ficha existente

const adjuntarValidators = [
  param('messageId').matches(MESSAGE_ID_RE).withMessage('messageId inválido'),
  body('referidoId').isInt({ min: 1 }).toInt(),
  body('from').optional({ nullable: true }).isString(),
  body('subject').optional({ nullable: true }).isString(),
]

async function adjuntar(req, res) {
  if (assertValid(res, req)) return

  const { messageId } = req.params
  const { referidoId, from, subject } = req.body

  const referido = await Referido.findByPk(referidoId)
  if (!referido) return res.status(404).json({ error: 'Referido no encontrado' })

  if (await buscarCorreoRevisado(messageId)) {
    return res.status(409).json({ error: 'Este correo ya fue revisado' })
  }

  if (!await inicializarGmail(res)) return

  // Se anota ANTES de guardar los adjuntos: el UNIQUE hace de candado, así dos
  // requests simultáneas no duplican los documentos. Si guardar falla, se suelta.
  let anotado
  try {
    anotado = await GmailCorreoRevisado.create({
      gmailMessageId: messageId,
      estado: ESTADOS.IMPORTADO,
      referidoId: referido.id,
      remitente: recortar(from),
      asunto: recortar(subject),
      revisadoPorUsuarioId: req.auth.id,
    })
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ error: 'Este correo ya fue revisado' })
    }
    throw err
  }

  try {
    const adjuntosGuardados = await guardarAdjuntosDeCorreo(messageId, referido)
    // Sin documentos no hay nada que adjuntar: anotarlo como importado dejaría
    // el correo fuera de la bandeja sin remedio (un importado no se restaura).
    if (adjuntosGuardados === 0) {
      await anotado.destroy().catch(() => {})
      return res.status(422).json({ error: 'El correo no tiene documentos que se puedan adjuntar' })
    }
    await gmailService.markAsRead(messageId)
    await gmailService.addLabel(messageId, 'Referido-Procesado')
    return res.json({ ok: true, adjuntosGuardados })
  } catch (err) {
    await anotado.destroy().catch(() => {})
    if (responderErrorGmail(res, err)) return
    console.error('[gmailBandeja] adjuntar FAIL', err.message)
    return res.status(500).json({ error: detalleOGenerico(err, 'No se pudieron adjuntar los documentos') })
  }
}

module.exports = wrapHandlers({
  adjunto, adjuntoValidators,
  adjuntar, adjuntarValidators,
  descartar, descartarValidators,
  historial, historialValidators,
  restaurar, restaurarValidators,
})
