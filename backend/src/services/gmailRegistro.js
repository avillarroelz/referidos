// backend/src/services/gmailRegistro.js
// Fuente única de "este correo de Gmail ya fue revisado": el registro
// (gmail_correos_revisados) ∪ referidos.gmail_message_id. Este último cubre los
// imports previos al registro.
const { getModel } = require('../db')

const GmailCorreoRevisado = getModel('GmailCorreoRevisado')
const Referido = getModel('Referido')
const { ESTADOS } = GmailCorreoRevisado

// Remitente y asunto vienen del correo: se recortan al ancho de la columna.
const recortar = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null)

/**
 * @returns {Promise<{estado: 'importado'|'descartado', referidoId: number|null} | null>}
 */
async function buscarCorreoRevisado(messageId) {
  const fila = await GmailCorreoRevisado.findOne({ where: { gmailMessageId: messageId } })
  if (fila) return { estado: fila.estado, referidoId: fila.referidoId ?? null }
  const referido = await Referido.findOne({ where: { gmailMessageId: messageId }, attributes: ['id'] })
  return referido ? { estado: ESTADOS.IMPORTADO, referidoId: referido.id } : null
}

// Versión por lote: set de los ids que ya están revisados.
async function idsYaRevisados(ids) {
  const [anotados, importados] = await Promise.all([
    GmailCorreoRevisado.findAll({ where: { gmailMessageId: ids }, attributes: ['gmailMessageId'], raw: true }),
    Referido.findAll({ where: { gmailMessageId: ids }, attributes: ['gmailMessageId'], raw: true }),
  ])
  return new Set([...anotados, ...importados].map(r => r.gmailMessageId))
}

// Anota el correo como importado en el registro de revisados. Si falla, el
// referido ya existe y el import no se tumba: se avisa sin datos del correo.
async function anotarCorreoImportado({ messageId, from, subject, referidoId, userId }) {
  try {
    const datos = { estado: ESTADOS.IMPORTADO, referidoId, revisadoPorUsuarioId: userId }
    const fila = await GmailCorreoRevisado.findOne({ where: { gmailMessageId: messageId } })
    if (fila) {
      // Estaba descartado y se importó igual: conserva remitente y asunto si no llegan.
      await fila.update({ ...datos, remitente: recortar(from) ?? fila.remitente, asunto: recortar(subject) ?? fila.asunto })
    } else {
      await GmailCorreoRevisado.create({ gmailMessageId: messageId, ...datos, remitente: recortar(from), asunto: recortar(subject) })
    }
  } catch (err) {
    console.warn('[gmailRegistro] No se pudo anotar el correo en el registro de revisados:', err.name)
  }
}

module.exports = { recortar, buscarCorreoRevisado, idsYaRevisados, anotarCorreoImportado }
