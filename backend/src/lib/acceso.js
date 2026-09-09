// backend/src/lib/acceso.js
// Criterio unico de acceso a un referido y a sus recursos anidados.
//
// Vivia duplicado en adjuntos.controller.js y faltaba por completo en
// comentarios; referidos lo tenia incompleto, sin el postulante. Al ser la
// tercera aparicion del mismo criterio se extrae aca, para que "quien puede
// tocar este referido" se responda en un solo lugar.

const ROL_EXTERNO = 'EXTERNO'
const ROLES_PRIVILEGIADOS = ['RRHH', 'ADMIN', 'JefeRRHH']
// Unico estado en que la postulacion todavia no la tomo nadie.
const ESTADO_INICIAL = 'PENDIENTE'

/**
 * Las cuatro relaciones legitimas con un referido. Se devuelven por separado
 * porque no todas habilitan lo mismo: leer depende de tener alguna, pero
 * eliminar depende de CUAL, y el postulante ademas depende del estado.
 */
function relacionesConReferido(auth, ref) {
  if (!auth?.id || !ref) {
    return { privilegiado: false, creador: false, postulante: false, adcAsignado: false }
  }

  const roles = auth.roles || []
  return {
    privilegiado: roles.some(r => ROLES_PRIVILEGIADOS.includes(r)),
    creador: ref.creadoPorUserId === auth.id,
    postulante: ref.postulanteUserId != null && ref.postulanteUserId === auth.id,
    adcAsignado: ref.asignadoADCUserId != null && ref.asignadoADCUserId === auth.id,
  }
}

/**
 * Acceso de LECTURA y de aporte: basta con tener cualquiera de las cuatro
 * relaciones. Un ADC no asignado queda fuera, como cualquier ajeno.
 */
function puedeAccederReferido(auth, ref) {
  return Object.values(relacionesConReferido(auth, ref)).some(Boolean)
}

/**
 * Acceso de ELIMINACION de documentos, mas restrictivo que el de lectura:
 *  - el ADC NO borra: aporta su informe, pero no elimina la evidencia sobre la
 *    que dictamina;
 *  - el postulante externo solo mientras nadie haya tomado su postulacion, o
 *    sea con el referido aun en PENDIENTE. Despues puede agregar, no quitar.
 */
function viaEliminacion(auth, ref) {
  const rel = relacionesConReferido(auth, ref)
  if (rel.privilegiado) return 'privilegiado'
  if (rel.creador) return 'creador'
  if (rel.postulante && ref?.estado === ESTADO_INICIAL) return 'postulante'
  return null
}

function puedeEliminarDocumentos(auth, ref) {
  return viaEliminacion(auth, ref) !== null
}

/**
 * Variante para usar dentro de un handler: responde 403 y devuelve false cuando
 * no hay acceso, para cortar con `if (!assertReferidoAccess(req, res, ref)) return`.
 */
function assertReferidoAccess(req, res, ref) {
  if (puedeAccederReferido(req.auth, ref)) return true
  res.status(403).json({ error: 'Sin permisos para acceder a este referido' })
  return false
}

/**
 * Middleware: deja pasar a cualquier rol INTERNO y bloquea al postulante externo.
 * Excluye EXTERNO en vez de enumerar los internos a proposito: una lista blanca
 * dejaria fuera en silencio a cualquier rol que se cree mas adelante.
 */
function requireInterno(req, res, next) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  if ((req.auth.roles || []).includes(ROL_EXTERNO)) {
    return res.status(403).json({ error: 'Sin permisos: acción reservada a usuarios internos' })
  }

  next()
}

module.exports = {
  relacionesConReferido,
  puedeAccederReferido,
  puedeEliminarDocumentos,
  viaEliminacion,
  assertReferidoAccess,
  requireInterno,
  ROL_EXTERNO,
  ROLES_PRIVILEGIADOS,
}
