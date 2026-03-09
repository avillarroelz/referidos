// backend/src/db/models/notificacion.model.js
module.exports = (sequelize, DataTypes) => {
  const Notificacion = sequelize.define(
    'notificacion',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      destinatarioUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'destinatario_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      tipo: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },

      titulo: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },

      mensaje: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      referidoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'referido_id',
        references: { model: 'referidos', key: 'id' },
      },

      leida: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      fechaLeida: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'fecha_leida',
      },

      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
      },
    },
    {
      tableName: 'notificaciones',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['destinatario_user_id', 'leida'] },
        { fields: ['referido_id'] },
      ],
    }
  )

  return Notificacion
}
