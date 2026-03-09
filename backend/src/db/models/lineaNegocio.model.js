// backend/src/db/models/lineaNegocio.model.js
module.exports = (sequelize, DataTypes) => {
  const LineaNegocio = sequelize.define(
    'lineaNegocio',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nombre: { type: DataTypes.STRING(120), allowNull: false, unique: true },
      descripcion: { type: DataTypes.STRING(255), allowNull: true },
      estado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
    },
    {
      tableName: 'linea_negocio',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  )

  return LineaNegocio
}
