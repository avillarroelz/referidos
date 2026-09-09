// backend/src/db/models/auditoriaDocumento.model.js
// Traza de eliminacion de documentos de un candidato (Ley 21.719).

const ACCIONES = { ELIMINACION: 'ELIMINACION' }
const VIAS_ACCESO = ['privilegiado', 'creador', 'postulante']

module.exports = (sequelize, DataTypes) => {
  const AuditoriaDocumento = sequelize.define(
    'auditoria_documentos',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Sin `references` a proposito: el documento se borra en la misma
      // operacion, y una FK en cascada se llevaria por delante la auditoria.
      documentoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'documento_id',
      },

      referidoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'referido_id',
        references: { model: 'referidos', key: 'id' },
      },

      actorUserId: {
        type: DataTypes.INTEGER,
        allowNull: true, // null = borrado por un proceso automatico
        field: 'actor_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      accion: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [Object.values(ACCIONES)] },
      },

      // Unico rastro de QUE se elimino una vez borrada la fila del documento.
      nombreArchivo: { type: DataTypes.STRING(255), allowNull: true, field: 'nombre_archivo' },
      s3Key: { type: DataTypes.TEXT, allowNull: true, field: 's3_key' },

      // Con que titulo se autorizo el borrado.
      viaAcceso: {
        type: DataTypes.STRING(20),
        allowNull: true,
        field: 'via_acceso',
        validate: { isIn: [VIAS_ACCESO] },
      },

      // VARCHAR(45) para que quepa una IPv6.
      ip: { type: DataTypes.STRING(45), allowNull: true },
    },
    {
      tableName: 'auditoria_documentos',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['referido_id', 'created_at'] },
        { fields: ['actor_user_id', 'created_at'] },
      ],
    }
  )

  AuditoriaDocumento.ACCIONES = ACCIONES
  AuditoriaDocumento.VIAS_ACCESO = VIAS_ACCESO

  return AuditoriaDocumento
}
