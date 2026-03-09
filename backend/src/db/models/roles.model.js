// backend/src/db/models/roles.model.js
module.exports = (sequelize, DataTypes) => {
  const Rol = sequelize.define(
    'roles',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
      descripcion: { type: DataTypes.STRING(255), allowNull: true }
    },
    {
      tableName: 'roles',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  )

  return Rol
}
