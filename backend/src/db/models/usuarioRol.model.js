// backend/src/db/models/usuarioRol.model.js
module.exports = (sequelize, DataTypes) => {
  const UsuarioRol = sequelize.define(
    'usuarioRol', // alias de modelo
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
        references: { model: 'usuarios', key: 'id' }
      },
      rolId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'rol_id',
        references: { model: 'roles', key: 'id' }
      }
    },
    {
      tableName: 'usuario_rol',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { unique: true, fields: ['usuario_id', 'rol_id'] }
      ]
    }
  )

  return UsuarioRol
}
