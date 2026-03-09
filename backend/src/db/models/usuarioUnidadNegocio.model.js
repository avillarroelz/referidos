// backend/src/db/models/usuarioUnidadNegocio.model.js
module.exports = (sequelize, DataTypes) => {
  const UsuarioUnidad = sequelize.define(
    'usuario_unidad', // alias de modelo
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'usuario_id',
        references: { model: 'usuarios', key: 'id' }
      },
      unidadNegocioId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'unidad_negocio_id',
        references: { model: 'unidad_negocio', key: 'id' }
      }
    },
    {
      tableName: 'usuario_unidad',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { unique: true, fields: ['usuario_id', 'unidad_negocio_id'] }
      ]
    }
  )

  return UsuarioUnidad
}
