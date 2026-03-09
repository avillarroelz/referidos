// backend/src/services/slaService.js
const { Op } = require('sequelize')
const { getModel } = require('../db')
const { notificarSLAVencido } = require('./notificationService')

/**
 * Verifica referidos en estado ENVIADO_ADC cuyo slaDeadline ya venció.
 * Se ejecuta periódicamente (cada hora).
 */
async function verificarSLAsVencidos() {
  try {
    const Referido = getModel('Referido')
    const Notificacion = getModel('Notificacion')
    const now = new Date()

    // Buscar referidos con SLA vencido que estén en ENVIADO_ADC
    const vencidos = await Referido.findAll({
      where: {
        estado: 'ENVIADO_ADC',
        slaDeadline: {
          [Op.ne]: null,
          [Op.lt]: now,
        },
      },
    })

    for (const referido of vencidos) {
      // Evitar duplicar notificaciones de SLA: verificar si ya se notificó en las últimas 24h
      const yaNotificado = await Notificacion.findOne({
        where: {
          referidoId: referido.id,
          tipo: 'sla_vencido',
          created_at: { [Op.gte]: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      })

      if (!yaNotificado) {
        await notificarSLAVencido(referido)
        console.log(`[SLA] Notificación enviada para referido #${referido.id} (${referido.nombre})`)
      }
    }

    if (vencidos.length > 0) {
      console.log(`[SLA] Verificación completada: ${vencidos.length} referidos con SLA vencido`)
    }
  } catch (err) {
    console.error('[SLA] Error al verificar SLAs:', err.message)
  }
}

module.exports = { verificarSLAsVencidos }
