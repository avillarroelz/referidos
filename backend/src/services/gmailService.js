// backend/src/services/gmailService.js
const { google } = require('googleapis')
const emailParserAI = require('./emailParserAI')
const pdfAnalyzerClient = require('./pdfAnalyzerClient')
const { config } = require('../config')
const { parsearRemitente } = require('./referidoDuplicado')

// Lazy-load para evitar crash si faltan dependencias
let mammoth
try { mammoth = require('mammoth') } catch (e) { console.warn('[GmailService] mammoth no disponible') }

// Delay helper para throttling
const delay = ms => new Promise(r => setTimeout(r, ms))

// Remitentes que no son una persona: correos automaticos y portales de empleo.
const LOCAL_AUTOMATICO = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|no[-_.]?responder|notificaci[oó]n(es)?|notifications?|mailer-daemon|postmaster|bounces?|alertas?|info|contacto|newsletter)([-_.+].*)?$/i
const AUTHSERV_ID = 'mx.google.com'
const DOMINIOS_PORTAL = /(^|\.)(laborum|computrabajo|chiletrabajos|trabajando|indeed|linkedin|bne)\.[a-z.]+$/i

// `authResults` ya viene filtrado por authserv-id en parseEmailContent.
function tieneAutenticacionDe(authResults, dominio) {
  if (!authResults) return false
  const d = dominio.replace(/[.]/g, '\\.')
  return authResults.split(';').some(clausula => {
    const c = clausula.trim().toLowerCase()
    if (/^dkim=pass\b/.test(c)) return new RegExp(`header\\.d=${d}(?![\\w.-])`).test(c)
    if (/^dmarc=pass\b/.test(c)) return new RegExp(`header\\.from=${d}(?![\\w.-])`).test(c)
    return false
  })
}

// Completa lo que la IA/regex no trajo con el remitente, sin pisar nada:
// interno (autenticado) = quien refiere; externo = el postulante; automatico = nadie.
// `rellenadoDesdeRemitente` lista lo rellenado: ese correo no identifica al postulante.
function rellenarDesdeRemitente(datos, from, authResults) {
  const remitente = parsearRemitente(from)
  if (!remitente) return datos
  const arroba = remitente.email.lastIndexOf('@')
  const local = remitente.email.slice(0, arroba)
  const dominio = remitente.email.slice(arroba + 1)
  if (LOCAL_AUTOMATICO.test(local) || DOMINIOS_PORTAL.test(dominio)) return datos

  const relleno = { ...datos }
  const rellenados = []
  if (dominio === config.auth.internalEmailDomain) {
    // Sin autenticacion el @ecora.cl puede ser falsificado: no se usa de ninguna forma.
    if (!tieneAutenticacionDe(authResults, dominio)) return datos
    if (!relleno.nombreReferidor && remitente.nombre) {
      relleno.nombreReferidor = remitente.nombre
      rellenados.push('nombreReferidor')
    }
  } else {
    if (!relleno.nombre && remitente.nombre) { relleno.nombre = remitente.nombre; rellenados.push('nombre') }
    if (!relleno.email) { relleno.email = remitente.email; rellenados.push('email') }
  }
  if (rellenados.length) relleno.rellenadoDesdeRemitente = rellenados
  return relleno
}

class GmailService {
  constructor() {
    this.gmail = null
    this.auth = null
    // Los PDF se analizan fuera de este proceso, en el sidecar Rust (services/pdf-analyzer).
    this.pdfAnalyzer = pdfAnalyzerClient
  }

  async initialize(credentials) {
    const { client_id, client_secret, redirect_uri, refresh_token } = credentials
    this.auth = new google.auth.OAuth2(client_id, client_secret, redirect_uri)
    this.auth.setCredentials({ refresh_token })
    this.gmail = google.gmail({ version: 'v1', auth: this.auth })
    return this
  }

  // ── Gmail API helpers ──────────────────────────────────────

  async searchEmails(query, maxResults = 20) {
    const all = []
    let pageToken = undefined

    while (all.length < maxResults) {
      const batchSize = Math.min(maxResults - all.length, 100) // Gmail API max es 100 por página
      const response = await this.gmail.users.messages.list({
        userId: 'me', q: query, maxResults: batchSize, pageToken
      })
      const messages = response.data.messages || []
      all.push(...messages)

      pageToken = response.data.nextPageToken
      if (!pageToken || messages.length === 0) break
    }

    return all
  }

  async getEmail(messageId) {
    const response = await this.gmail.users.messages.get({
      userId: 'me', id: messageId, format: 'full'
    })
    return response.data
  }

  async markAsRead(messageId) {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me', id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] }
      })
    } catch (err) {
      console.error('[Gmail] Error marcando como leido:', err.message)
    }
  }

  async addLabel(messageId, labelName) {
    try {
      const labelsResponse = await this.gmail.users.labels.list({ userId: 'me' })
      let label = labelsResponse.data.labels.find(l => l.name === labelName)
      if (!label) {
        const r = await this.gmail.users.labels.create({
          userId: 'me',
          requestBody: { name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }
        })
        label = r.data
      }
      await this.gmail.users.messages.modify({
        userId: 'me', id: messageId,
        requestBody: { addLabelIds: [label.id] }
      })
    } catch (err) {
      console.error('[Gmail] Error agregando etiqueta:', err.message)
    }
  }

  // ── Extraer contenido del correo ───────────────────────────

  parseEmailContent(email) {
    const headers = email.payload.headers
    const subject = headers.find(h => h.name === 'Subject')?.value || ''
    const from = headers.find(h => h.name === 'From')?.value || ''
    const date = headers.find(h => h.name === 'Date')?.value || ''
    // Resultado de autenticacion del servidor receptor. Solo vale el que escribio Gmail
    // (authserv-id mx.google.com): los demas, y todo ARC-*, los puede fabricar el remitente.
    const authResults = headers
      .filter(h => h.name?.toLowerCase() === 'authentication-results')
      .map(h => h.value || '')
      .find(v => v.split(';')[0].trim().toLowerCase() === AUTHSERV_ID) || ''

    let body = ''
    const extractBody = (payload) => {
      if (payload.parts) {
        // Buscar text/plain primero, luego text/html
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain')
        if (textPart?.body?.data) {
          return Buffer.from(textPart.body.data, 'base64').toString('utf-8')
        }
        // Recurse en multipart
        for (const part of payload.parts) {
          if (part.parts) {
            const found = extractBody(part)
            if (found) return found
          }
        }
      } else if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8')
      }
      return ''
    }
    body = extractBody(email.payload)

    return { subject, from, date, authResults, body, bodyPreview: body.substring(0, 1000) }
  }

  // ── Adjuntos ───────────────────────────────────────────────

  // Obtener solo adjuntos legibles para extracción de texto (PDF, Word, TXT)
  getReadableAttachmentParts(payload, parts = []) {
    if (!payload.parts) return parts
    for (const part of payload.parts) {
      if (part.filename && part.body?.attachmentId) {
        const mime = (part.mimeType || '').toLowerCase()
        const name = (part.filename || '').toLowerCase()
        if (mime.includes('pdf') || name.endsWith('.pdf')
          || mime.includes('word') || mime.includes('document') || name.endsWith('.docx')
          || name.endsWith('.txt') || mime === 'text/plain') {
          parts.push({
            filename: part.filename,
            mimeType: part.mimeType,
            attachmentId: part.body.attachmentId,
            size: part.body.size || 0
          })
        }
      }
      if (part.parts) this.getReadableAttachmentParts(part, parts)
    }
    return parts
  }

  // Obtener TODOS los adjuntos (para guardarlos al importar)
  getAllAttachmentParts(payload, parts = []) {
    if (!payload.parts) return parts
    for (const part of payload.parts) {
      if (part.filename && part.body?.attachmentId) {
        parts.push({
          filename: part.filename,
          mimeType: part.mimeType,
          attachmentId: part.body.attachmentId,
          size: part.body.size || 0
        })
      }
      if (part.parts) this.getAllAttachmentParts(part, parts)
    }
    return parts
  }

  async downloadAttachment(messageId, attachmentId) {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me', messageId, id: attachmentId
      })
      return Buffer.from(response.data.data, 'base64')
    } catch (err) {
      console.error(`[Gmail] Error descargando adjunto:`, err.message)
      return null
    }
  }

  async extractTextFromFile(buffer, filename, mimeType) {
    const name = (filename || '').toLowerCase()
    const mime = (mimeType || '').toLowerCase()

    try {
      if (name.endsWith('.pdf') || mime.includes('pdf')) {
        const result = await this.pdfAnalyzer.analyzePdf(buffer, { images: false })
        return (result.text || []).map(p => p.text).filter(Boolean).join('\n\n')
      }

      if ((name.endsWith('.docx') || mime.includes('word') || mime.includes('document')) && mammoth) {
        const result = await mammoth.extractRawText({ buffer })
        return result.value || ''
      }

      if (name.endsWith('.txt') || mime === 'text/plain') {
        return buffer.toString('utf-8')
      }
    } catch (err) {
      // Sin el nombre del archivo: casi siempre trae el nombre del postulante.
      console.warn(`[Gmail] Error leyendo un adjunto (${buffer?.length ?? 0} bytes): ${err.message}`)
    }
    return ''
  }

  async extractAttachmentsText(messageId, payload) {
    const parts = this.getReadableAttachmentParts(payload)
    if (parts.length === 0) return { text: '', filenames: [] }

    const texts = []
    const filenames = []

    for (const att of parts) {
      if (att.size > 5 * 1024 * 1024) continue // Max 5MB

      const buffer = await this.downloadAttachment(messageId, att.attachmentId)
      if (!buffer) continue

      const text = await this.extractTextFromFile(buffer, att.filename, att.mimeType)
      if (text && text.trim().length > 20) {
        texts.push(`--- ${att.filename} ---\n${text.substring(0, 5000)}`)
        filenames.push(att.filename)
        console.log(`[Gmail] Leido un adjunto de ${messageId} (${text.length} chars)`)
      }
    }

    return { text: texts.join('\n\n'), filenames }
  }

  // ── Procesamiento completo de un correo ────────────────────

  async processOneEmail(messageId, preguntas = []) {
    const email = await this.getEmail(messageId)
    const parsed = this.parseEmailContent(email)

    // 1. Extraer texto de adjuntos legibles (para IA)
    const readableText = await this.extractAttachmentsText(messageId, email.payload)

    // 2. Obtener lista completa de TODOS los adjuntos (para guardar al importar)
    const allParts = this.getAllAttachmentParts(email.payload)

    // 3. Determinar fuente: adjuntos > body
    let content, source
    if (readableText.text && readableText.text.trim().length > 100) {
      content = readableText.text
      source = 'doc'
    } else {
      content = parsed.body
      source = 'email'
    }

    // 4. Extraer datos con IA (o regex como fallback)
    let extractedData = {}
    let parseSource = 'regex'
    let respuestas = []

    if (emailParserAI.isAvailable() && content.trim().length > 20) {
      try {
        const { respuestas: respuestasIA, ...datos } = await emailParserAI.parse(
          content, parsed.subject, parsed.from, source === 'doc', preguntas
        )
        extractedData = datos
        respuestas = respuestasIA || []
        parseSource = source === 'doc' ? 'ai-doc' : 'ai'
      } catch (err) {
        console.warn(`[Gmail] IA falló para ${messageId}: ${err.message}`)
        extractedData = this._regexFallback(parsed.body, parsed.subject)
        parseSource = 'regex'
      }
    } else {
      extractedData = this._regexFallback(parsed.body, parsed.subject)
    }

    extractedData = rellenarDesdeRemitente(extractedData, parsed.from, parsed.authResults)

    return {
      id: messageId,
      subject: parsed.subject,
      from: parsed.from,
      date: parsed.date,
      bodyPreview: parsed.bodyPreview,
      attachments: allParts.map(p => p.filename),
      // Sin attachmentId: el front identifica el adjunto por su posición y el
      // backend lo vuelve a resolver contra Gmail (vista previa, import).
      attachmentParts: allParts.map(({ filename, mimeType, size }) => ({ filename, mimeType, size })),
      extractedData,
      respuestas,
      parseSource
    }
  }

  _regexFallback(body, subject) {
    const r = this.extractReferidoData(body, subject)
    return {
      nombre: r.nombre || null,
      email: r.email || null,
      telefono: r.telefono || null,
      rut: r.rut || null,
      cargoPostulado: r.cargo || null,
      observaciones: r.observaciones || null,
      nombreReferidor: r.referidoPor || null
    }
  }

  // ── Regex fallback (no cambia) ─────────────────────────────

  extractReferidoData(text, subject = '') {
    const fullText = `${subject}\n${text}`
    const patterns = {
      nombre: /\*?\*?Nombre\*?\*?:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\n|-|$)/i,
      rut: /\*?\*?RUT\*?\*?:\s*(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])/i,
      email: /\*?\*?Email\*?\*?:\s*([\w.-]+@[\w.-]+\.\w+)/i,
      telefono: /\*?\*?Tel[ée]fono\*?\*?:\s*(\+?56\s?9\s?\d{4}\s?\d{4})/i,
      cargo: /\*?\*?Cargo\s+Postulado\*?\*?:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\n|$)/i,
      observaciones: /\*?\*?Observaciones\*?\*?:\s*([^\n]+(?:\n(?!\*?\*?Referido por)[^\n]+)*)/i,
      referidoPor: /\*?\*?Referido\s+por\*?\*?:\s*([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\n|$)/i
    }
    const extracted = {}
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = fullText.match(pattern)
      if (match?.[1]) extracted[key] = match[1].replace(/\s+/g, ' ').trim()
    }
    if (!extracted.nombre) {
      const g = fullText.match(/(?:nombre|candidato|referido)[\s:]+([A-Za-zÁÉÍÓÚáéíóúñÑ\s]+?)(?:\n|-|RUT)/i)
      if (g) extracted.nombre = g[1].trim()
    }
    if (!extracted.email) {
      const g = fullText.match(/[\w.-]+@[\w.-]+\.\w+/i)
      if (g) extracted.email = g[0].trim()
    }
    if (!extracted.telefono) {
      const g = fullText.match(/(?:\+?56\s?)?9\s?\d{4}\s?\d{4}/i)
      if (g) extracted.telefono = g[0].trim()
    }
    if (!extracted.rut) {
      const g = fullText.match(/\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/i)
      if (g) extracted.rut = g[0].trim()
    }
    return extracted
  }
}

module.exports = new GmailService()
