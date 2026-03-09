// backend/src/db/models/unidadNegocio.model.js
module.exports = (sequelize, DataTypes) => {
  const UnidadNegocio = sequelize.define(
    'unidadNegocio',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nombre: { type: DataTypes.STRING(150), allowNull: false, unique: true },
      descripcion: { type: DataTypes.STRING(255), allowNull: true },
      estado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      lineaNegocioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'linea_negocio_id',
        references: { model: 'linea_negocio', key: 'id' }
      }
    },
    {
      tableName: 'unidad_negocio',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['linea_negocio_id'] }]
    }
  )

  return UnidadNegocio
}
