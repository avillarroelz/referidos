// backend/src/db/models/estadoHistorial.model.js
const { ESTADOS } = require('../../lib/estados')

module.exports = (sequelize, DataTypes) => {
  const EstadoHistorial = sequelize.define(
    'estado_historial',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      referidoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'referido_id',
        references: { model: 'referidos', key: 'id' },
      },

      actorUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'actor_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      desde: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [Object.values(ESTADOS)] },
      },

      hacia: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: { isIn: [Object.values(ESTADOS)] },
      },

      comentario: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'estado_historial',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['referido_id'] }, { fields: ['actor_user_id'] }],
    }
  )

  return EstadoHistorial
}
