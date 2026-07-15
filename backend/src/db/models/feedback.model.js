// backend/src/db/models/feedback.model.js
// Reportes de la pantalla principal: bugs, correcciones o recomendaciones que
// envían los usuarios internos. Las imágenes adjuntas viven en S3 (carpeta feedback/)
// y aquí se guarda su metadata en el campo JSONB `imagenes`.
module.exports = (sequelize, DataTypes) => {
  const Feedback = sequelize.define(
    'feedback',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Tipo de reporte: BUG | CORRECCION | RECOMENDACION
      tipo: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'BUG',
      },

      titulo: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },

      mensaje: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      // Ruta del frontend desde la que se reportó (para ubicar el problema)
      url: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },

      // Estado de seguimiento: PENDIENTE | EN_REVISION | RESUELTO | DESCARTADO
      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'PENDIENTE',
      },

      autorUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'autor_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      // [{ nombre, s3Key, ruta, mimetype, size }]
      imagenes: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: [],
      },

      // Nota del ADMIN al resolver/descartar
      notaResolucion: {
        type: DataTypes.TEXT,
        allowNull: true,
        field: 'nota_resolucion',
      },
    },
    {
      tableName: 'feedbacks',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['estado'] },
        { fields: ['autor_user_id'] },
      ],
    }
  )

  return Feedback
}
