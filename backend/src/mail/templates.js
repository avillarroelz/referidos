function newReferidoTemplate(ref, creador) {
  const titulo = `Nuevo referido #${ref.id} – ${ref.nombre}`
  const html = `
    <h2>${titulo}</h2>
    <p>Creado por: <strong>${creador?.username || 'Usuario'}</strong> (${creador?.correo || '-'})</p>
    <ul>
      <li>Cargo: ${ref.cargoPostulado || '-'}</li>
      <li>Email: ${ref.email || '-'}</li>
      <li>Teléfono: ${ref.telefono || '-'}</li>
      <li>Estado: ${ref.estado}</li>
    </ul>
  `
  return { subject: titulo, html, text: `${titulo}\nEstado: ${ref.estado}` }
}

function estadoActualizadoTemplate(ref, anterior, nuevo, actor, comentario) {
  const titulo = `Cambio de estado #${ref.id}: ${anterior} → ${nuevo}`
  const html = `
    <h2>${titulo}</h2>
    <p>Actor: <strong>${actor?.username || 'Usuario'}</strong> (${actor?.correo || '-'})</p>
    <ul>
      <li>Referido: ${ref.nombre}</li>
      <li>Cargo: ${ref.cargoPostulado || '-'}</li>
      <li>Comentario: ${comentario || '-'}</li>
    </ul>
  `
  return { subject: titulo, html, text: `${titulo}\nComentario: ${comentario || '-'}` }
}

module.exports = { newReferidoTemplate, estadoActualizadoTemplate }
