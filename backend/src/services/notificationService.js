// backend/src/services/notificationService.js
const { getModel } = require('../db')
const { Op } = require('sequelize')

/**
 * Crea una notificación en la base de datos.
 */
async function crearNotificacion({ destinatarioUserId, tipo, titulo, mensaje, referidoId = null, metadata = {} }) {
  const Notificacion = getModel('Notificacion')
  return Notificacion.create({
    destinatarioUserId,
    tipo,
    titulo,
    mensaje,
    referidoId,
    metadata,
  })
}

/**
 * Notifica cambio de estado a creador del referido + ADC asignado (si aplica).
 */
async function notificarCambioEstado(referido, desde, hacia, actorUserId) {
  const destinatarios = new Set()

  // Notificar al creador del referido
  if (referido.creadoPorUserId && referido.creadoPorUserId !== actorUserId) {
    destinatarios.add(referido.creadoPorUserId)
  }

  // Notificar al ADC asignado
  if (referido.asignadoADCUserId && referido.asignadoADCUserId !== actorUserId) {
    destinatarios.add(referido.asignadoADCUserId)
  }

  const promises = [...destinatarios].map(uid =>
    crearNotificacion({
      destinatarioUserId: uid,
      tipo: 'cambio_estado',
      titulo: 'Cambio de Estado',
      mensaje: `${referido.nombre}: ${desde} → ${hacia}`,
      referidoId: referido.id,
      metadata: { desde, hacia },
    })
  )

  return Promise.all(promises)
}

/**
 * Notifica nuevo comentario solo a quienes pueden leerlo (decisión 30-09):
 * ADC asignado y creador únicamente si tiene rol de gestión. Nunca al autor.
 */
async function notificarComentario(referido, autorUserId, autorNombre) {
  const destinatarios = new Set()

  if (referido.creadoPorUserId && referido.creadoPorUserId !== autorUserId) {
    const creador = await getModel('Usuario').findByPk(referido.creadoPorUserId, {
      include: [{ model: getModel('Rol'), as: 'roles' }],
    })
    if (creador?.roles?.some(r => ['RRHH', 'JefeRRHH', 'ADMIN'].includes(r.nombre))) {
      destinatarios.add(referido.creadoPorUserId)
    }
  }
  if (referido.asignadoADCUserId && referido.asignadoADCUserId !== autorUserId) {
    destinatarios.add(referido.asignadoADCUserId)
  }

  const promises = [...destinatarios].map(uid =>
    crearNotificacion({
      destinatarioUserId: uid,
      tipo: 'comentario',
      titulo: 'Nuevo Comentario',
      mensaje: `${autorNombre} comentó en ${referido.nombre}`,
      referidoId: referido.id,
    })
  )

  return Promise.all(promises)
}

/**
 * Notifica al ADC que le fue asignado un referido.
 */
async function notificarAsignacion(referido, adcUserId) {
  return crearNotificacion({
    destinatarioUserId: adcUserId,
    tipo: 'asignacion',
    titulo: 'Nuevo Referido Asignado',
    mensaje: `Se te ha asignado el referido: ${referido.nombre}`,
    referidoId: referido.id,
  })
}

/**
 * Notifica a todos los RRHH sobre un nuevo referido desde el formulario público.
 */
async function notificarNuevoReferidoPublico(referido) {
  const Usuario = getModel('Usuario')
  const Rol = getModel('Rol')

  const rolRRHH = await Rol.findOne({ where: { nombre: 'RRHH' } })
  if (!rolRRHH) return

  const usersRRHH = await rolRRHH.getUsuarios()

  const promises = usersRRHH.map(u =>
    crearNotificacion({
      destinatarioUserId: u.id,
      tipo: 'referido_publico',
      titulo: 'Nuevo Referido Público',
      mensaje: `${referido.nombre} fue referido desde el formulario público`,
      referidoId: referido.id,
    })
  )

  return Promise.all(promises)
}

/**
 * Notifica SLA vencido al ADC asignado y a todos los RRHH.
 */
async function notificarSLAVencido(referido) {
  const Rol = getModel('Rol')
  const destinatarios = new Set()

  // ADC asignado
  if (referido.asignadoADCUserId) {
    destinatarios.add(referido.asignadoADCUserId)
  }

  // Todos los RRHH
  const rolRRHH = await Rol.findOne({ where: { nombre: 'RRHH' } })
  if (rolRRHH) {
    const usersRRHH = await rolRRHH.getUsuarios()
    usersRRHH.forEach(u => destinatarios.add(u.id))
  }

  const promises = [...destinatarios].map(uid =>
    crearNotificacion({
      destinatarioUserId: uid,
      tipo: 'sla_vencido',
      titulo: 'SLA Vencido',
      mensaje: `El referido ${referido.nombre} superó el plazo de respuesta ADC`,
      referidoId: referido.id,
      metadata: { slaDeadline: referido.slaDeadline },
    })
  )

  return Promise.all(promises)
}

module.exports = {
  crearNotificacion,
  notificarCambioEstado,
  notificarComentario,
  notificarAsignacion,
  notificarNuevoReferidoPublico,
  notificarSLAVencido,
}
