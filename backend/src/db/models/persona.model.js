// backend/src/db/models/persona.model.js
module.exports = (sequelize, DataTypes) => {
  const Persona = sequelize.define(
    'persona',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      usuarioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'usuario_id',
        references: { model: 'usuarios', key: 'id' }
      },
      nombres: { type: DataTypes.STRING(120), allowNull: false },
      apellidos: { type: DataTypes.STRING(120), allowNull: false },
      rut: { type: DataTypes.STRING(20), allowNull: true, unique: true },
      telefono: { type: DataTypes.STRING(30), allowNull: true },
      email: { type: DataTypes.STRING(150), allowNull: true, validate: { isEmail: true } },
      direccion: { type: DataTypes.STRING(200), allowNull: true },
      fecha_nacimiento: { type: DataTypes.DATEONLY, allowNull: true }
    },
    {
      tableName: 'personas',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [{ fields: ['usuario_id'] }, { unique: true, fields: ['rut'] }]
    }
  )

  return Persona
}
