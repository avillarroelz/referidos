module.exports = (sequelize, DataTypes) => {
  const Documento = sequelize.define(
    'documento',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nombre: { type: DataTypes.STRING(200), allowNull: false },
      ruta: { type: DataTypes.STRING(500), allowNull: false },
      s3Key: { type: DataTypes.STRING(500), allowNull: true, field: 's3_key' },
      mimetype: { type: DataTypes.STRING(120), allowNull: true },
      size: { type: DataTypes.INTEGER, allowNull: true },
      personaId: { type: DataTypes.INTEGER, allowNull: true, field: 'persona_id' },
      referidoId: { type: DataTypes.INTEGER, allowNull: true, field: 'referido_id', references: { model: 'referidos', key: 'id' } }
    },
    {
      tableName: 'documentos',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['persona_id'] }, { fields: ['referido_id'] }]
    }
  )
  return Documento
}
