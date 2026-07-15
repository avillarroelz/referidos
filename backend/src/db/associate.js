// backend/src/db/associate.js
/**
 * Define TODAS las asociaciones entre tus modelos en un solo lugar.
 * No modifica los archivos de modelos. Así mantenemos el esquema limpio y centralizado.
 */
module.exports = function associate(models) {
  // util: toma el primero que exista
  const pick = (...names) => names.map(n => models[n]).find(Boolean)

  // ───────────────────────────────────────────────────────────────────────────────
  // Pick de modelos (tolerante a nombres)
  const Usuario        = pick('usuario', 'Usuario', 'usuarios')
  const Rol            = pick('roles', 'Rol')
  const UsuarioRol     = pick('usuarioRol', 'usuario_rol', 'UsuarioRol')

  const LineaNegocio   = pick('lineaNegocio', 'LineaNegocio', 'linea_negocio')
  const UnidadNegocio  = pick('unidadNegocio', 'UnidadNegocio', 'unidad_negocio')
  const UsuarioUnidad  = pick('usuario_unidad', 'usuarioUnidad', 'usuarioUnidadNegocio', 'UsuarioUnidad')

  const Persona        = pick('persona', 'Persona', 'personas')
  const Documento      = pick('documento', 'Documento', 'documentos')
  const Referido       = pick('referido', 'Referido', 'referidos')
  const EstadoHistorial= pick('estado_historial', 'EstadoHistorial', 'historial')
  const Comentario     = pick('comentario', 'Comentario', 'comentarios')
  const Notificacion   = pick('notificacion', 'Notificacion', 'notificaciones')
  const Feedback       = pick('feedback', 'Feedback', 'feedbacks')

  // ───────────────────────────────────────────────────────────────────────────────
  // Usuario ↔ Rol (N:M) a través de UsuarioRol
  if (Usuario && Rol && UsuarioRol) {
    Usuario.belongsToMany(Rol, {
      through: UsuarioRol,
      foreignKey: 'usuarioId',
      otherKey: 'rolId',
      as: 'roles'
    })
    Rol.belongsToMany(Usuario, {
      through: UsuarioRol,
      foreignKey: 'rolId',
      otherKey: 'usuarioId',
      as: 'usuarios'
    })
  }

  // Usuario ↔ UnidadNegocio (N:M) a través de UsuarioUnidad
  if (Usuario && UnidadNegocio && UsuarioUnidad) {
    Usuario.belongsToMany(UnidadNegocio, {
      through: UsuarioUnidad,
      foreignKey: 'usuarioId',
      otherKey: 'unidadNegocioId',
      as: 'unidadNegocios'
    })
    UnidadNegocio.belongsToMany(Usuario, {
      through: UsuarioUnidad,
      foreignKey: 'unidadNegocioId',
      otherKey: 'usuarioId',
      as: 'usuarios'
    })
  }

  // LineaNegocio 1:N UnidadNegocio
  if (LineaNegocio && UnidadNegocio) {
    LineaNegocio.hasMany(UnidadNegocio, {
      as: 'unidadesNegocio',
      foreignKey: 'lineaNegocioId',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE'
    })
    UnidadNegocio.belongsTo(LineaNegocio, {
      as: 'lineaNegocio',
      foreignKey: 'lineaNegocioId'
    })
  }

  // Usuario 1:1 Persona (persona.usuarioId nullable)
  if (Usuario && Persona) {
    Usuario.hasOne(Persona, {
      as: 'persona',
      foreignKey: 'usuarioId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    })
    Persona.belongsTo(Usuario, {
      as: 'usuario',
      foreignKey: 'usuarioId'
    })
  }

  // Persona 1:N Documento
  if (Persona && Documento) {
    Persona.hasMany(Documento, {
      as: 'documentos',
      foreignKey: 'personaId',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    })
    Documento.belongsTo(Persona, {
      as: 'persona',
      foreignKey: 'personaId'
    })
  }

  // Usuario 1:N Referido (creadoPor)
  if (Usuario && Referido) {
    Usuario.hasMany(Referido, {
      as: 'referidosCreados',
      foreignKey: 'creadoPorUserId',
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    })
    Referido.belongsTo(Usuario, {
      as: 'creadoPor',
      foreignKey: 'creadoPorUserId',
    })

    // Usuario 1:N Referido (ADC asignado)
    Usuario.hasMany(Referido, {
      as: 'referidosAsignadosADC',
      foreignKey: 'asignadoADCUserId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    Referido.belongsTo(Usuario, {
      as: 'adcAsignado',
      foreignKey: 'asignadoADCUserId',
    })

    // Usuario 1:N Referido (postulante externo)
    Usuario.hasMany(Referido, {
      as: 'misPostulaciones',
      foreignKey: 'postulanteUserId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    Referido.belongsTo(Usuario, {
      as: 'postulante',
      foreignKey: 'postulanteUserId',
    })
  }

  // Referido 1:N EstadoHistorial
  if (Referido && EstadoHistorial) {
    Referido.hasMany(EstadoHistorial, {
      as: 'historial',
      foreignKey: 'referidoId',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    })
    EstadoHistorial.belongsTo(Referido, {
      as: 'referido',
      foreignKey: 'referidoId',
    })
  }

  // Referido 1:N Documento
  if (Referido && Documento) {
    Referido.hasMany(Documento, { as: 'adjuntos', foreignKey: 'referidoId', onDelete: 'CASCADE', onUpdate: 'CASCADE' })
    Documento.belongsTo(Referido, { as: 'referido', foreignKey: 'referidoId' })
  }

  // UnidadNegocio 1:N Referido
  if (UnidadNegocio && Referido) {
    UnidadNegocio.hasMany(Referido, {
      as: 'referidos',
      foreignKey: 'unidadNegocioId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    Referido.belongsTo(UnidadNegocio, {
      as: 'unidadNegocio',
      foreignKey: 'unidadNegocioId',
    })
  }

  // Usuario 1:N EstadoHistorial (actor)
  if (Usuario && EstadoHistorial) {
    Usuario.hasMany(EstadoHistorial, {
      as: 'acciones',
      foreignKey: 'actorUserId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    EstadoHistorial.belongsTo(Usuario, {
      as: 'actor',
      foreignKey: 'actorUserId',
    })
  }

  // ── Nuevas asociaciones ──

  // Referido 1:N Comentario
  if (Referido && Comentario) {
    Referido.hasMany(Comentario, {
      as: 'comentarios',
      foreignKey: 'referidoId',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    })
    Comentario.belongsTo(Referido, {
      as: 'referido',
      foreignKey: 'referidoId',
    })
  }

  // Usuario 1:N Comentario (autor)
  if (Usuario && Comentario) {
    Usuario.hasMany(Comentario, {
      as: 'comentariosEscritos',
      foreignKey: 'autorUserId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    Comentario.belongsTo(Usuario, {
      as: 'autor',
      foreignKey: 'autorUserId',
    })
  }

  // Usuario 1:N Notificacion (destinatario)
  if (Usuario && Notificacion) {
    Usuario.hasMany(Notificacion, {
      as: 'notificaciones',
      foreignKey: 'destinatarioUserId',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    })
    Notificacion.belongsTo(Usuario, {
      as: 'destinatario',
      foreignKey: 'destinatarioUserId',
    })
  }

  // Referido 1:N Notificacion
  if (Referido && Notificacion) {
    Referido.hasMany(Notificacion, {
      as: 'notificaciones',
      foreignKey: 'referidoId',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    })
    Notificacion.belongsTo(Referido, {
      as: 'referido',
      foreignKey: 'referidoId',
    })
  }

  // Usuario 1:N Feedback (autor)
  if (Usuario && Feedback) {
    Usuario.hasMany(Feedback, {
      as: 'feedbacks',
      foreignKey: 'autorUserId',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    })
    Feedback.belongsTo(Usuario, {
      as: 'autor',
      foreignKey: 'autorUserId',
    })
  }
}
