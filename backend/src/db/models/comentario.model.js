// backend/src/db/models/comentario.model.js
module.exports = (sequelize, DataTypes) => {
  const Comentario = sequelize.define(
    'comentario',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      referidoId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'referido_id',
        references: { model: 'referidos', key: 'id' },
      },

      autorUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'autor_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      mensaje: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      // Roles que pueden ver este comentario (CSV)
      visibleParaRoles: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'RRHH,ADC,ADMIN',
        field: 'visible_para_roles',
      },
    },
    {
      tableName: 'comentarios',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['referido_id'] },
        { fields: ['autor_user_id'] },
      ],
    }
  )

  return Comentario
}
