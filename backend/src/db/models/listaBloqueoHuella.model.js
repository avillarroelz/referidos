// backend/src/db/models/listaBloqueoHuella.model.js
// Respaldo local de la lista de no recontratación de black: solo huellas
// HMAC-SHA256 del RUT (hex). No guarda RUT, nombre ni motivo; no es reversible
// sin la clave de huella. Se usa únicamente cuando black no responde.

module.exports = (sequelize, DataTypes) => {
  const ListaBloqueoHuella = sequelize.define(
    'lista_bloqueo_huellas',
    {
      huella: { type: DataTypes.STRING(64), primaryKey: true },
    },
    {
      tableName: 'lista_bloqueo_huellas',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  )

  return ListaBloqueoHuella
}
