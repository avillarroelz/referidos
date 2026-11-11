// backend/src/services/gmailAdjuntos.js
// Guarda los adjuntos de un correo de Gmail como documentos de un referido
// (S3 si está configurado, copia local si no o si S3 falla). Lo comparten el
// import de correos y "adjuntar a una ficha existente".
const fs = require('fs')
const path = require('path')
const { getModel } = require('../db')
const gmailService = require('./gmailService')
const s3Service = require('./s3Service')
const { logger } = require('../utils/logger')

const MAX_ADJUNTO = 10 * 1024 * 1024

/**
 * Descarga los adjuntos del correo y los guarda como Documento del referido.
 * gmailService debe estar inicializado. Un fallo al obtener el correo se
 * propaga; un fallo con un adjunto concreto se registra y sigue con el resto.
 * @returns {Promise<number>} cantidad de adjuntos guardados
 */
async function guardarAdjuntosDeCorreo(messageId, referido) {
  const Documento = getModel('Documento')
  const useS3 = s3Service.isConfigured()

  const email = await gmailService.getEmail(messageId)
  const allParts = gmailService.getAllAttachmentParts(email.payload)
  let guardados = 0

  // Los logs llevan messageId, índice y tamaño; nunca el nombre del archivo ni
  // su ruta: el nombre de un CV casi siempre trae el nombre de la persona.
  for (const [indice, att] of allParts.entries()) {
    if (att.size > MAX_ADJUNTO) continue

    try {
      const buffer = await gmailService.downloadAttachment(messageId, att.attachmentId)
      if (!buffer) continue

      let rutaFinal = null
      let s3Key = null

      if (useS3) {
        try {
          s3Key = s3Service.generateReferidoFileKey(
            referido.rut || 'sin-rut', referido.id, att.filename, 'documento'
          )
          await s3Service.uploadFile(buffer, s3Key, att.mimeType, {
            referidoId: String(referido.id),
            originalName: att.filename,
            source: 'gmail'
          })
          rutaFinal = s3Key
          console.log(`[gmailAdjuntos] S3: adjunto ${indice} de ${messageId} (${buffer.length} bytes)`)
        } catch (s3Err) {
          // La key ya estaba asignada: sin esto la fila afirma estar en S3 y no lo está.
          s3Key = null
          logger.error('[gmailAdjuntos] Falló la subida a S3, queda solo copia local', {
            referidoId: referido.id, messageId, adjunto: indice, error: s3Err.message,
          })
        }
      }

      // Fallback local si S3 no configurado o falló
      if (!rutaFinal) {
        const uploadsDir = path.join(process.cwd(), 'uploads', 'referidos')
        fs.mkdirSync(uploadsDir, { recursive: true })
        const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        const localName = `${Date.now()}-${safeName}`
        const localPath = path.join(uploadsDir, localName)
        fs.writeFileSync(localPath, buffer)
        rutaFinal = `uploads/referidos/${localName}`
        console.log(`[gmailAdjuntos] Local: adjunto ${indice} de ${messageId} (${buffer.length} bytes)`)
      }

      await Documento.create({
        nombre: att.filename,
        ruta: rutaFinal,
        s3Key: s3Key,
        mimetype: att.mimeType,
        size: buffer.length,
        referidoId: referido.id
      })
      guardados++
    } catch (attErr) {
      console.warn(`[gmailAdjuntos] Error guardando el adjunto ${indice} de ${messageId}:`, attErr.message)
    }
  }

  return guardados
}

module.exports = { guardarAdjuntosDeCorreo }
