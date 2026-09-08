// backend/src/lib/acceso.js
// Criterio unico de acceso a un referido y a sus recursos anidados.
//
// Vivia duplicado en adjuntos.controller.js y faltaba por completo en
// comentarios; referidos lo tenia incompleto, sin el postulante. Al ser la
// tercera aparicion del mismo criterio se extrae aca, para que "quien puede
// tocar este referido" se responda en un solo lugar.

const ROL_EXTERNO = 'EXTERNO'
const ROLES_PRIVILEGIADOS = ['RRHH', 'ADMIN', 'JefeRRHH']

/**
 * Las cuatro relaciones legitimas con un referido: rol privilegiado, quien lo
 * creo, el postulante externo dueño de su propia postulacion, y el ADC que lo
 * tiene asignado. Un ADC no asignado queda fuera, como cualquier ajeno.
 */
function puedeAccederReferido(auth, ref) {
  if (!auth?.id || !ref) return false

  const roles = auth.roles || []
  const esPrivilegiado = roles.some(r => ROLES_PRIVILEGIADOS.includes(r))
  const esCreador = ref.creadoPorUserId === auth.id
  const esPostulante = ref.postulanteUserId != null && ref.postulanteUserId === auth.id
  const esAdcAsignado = ref.asignadoADCUserId != null && ref.asignadoADCUserId === auth.id

  return esPrivilegiado || esCreador || esPostulante || esAdcAsignado
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
  puedeAccederReferido,
  assertReferidoAccess,
  requireInterno,
  ROL_EXTERNO,
  ROLES_PRIVILEGIADOS,
}
