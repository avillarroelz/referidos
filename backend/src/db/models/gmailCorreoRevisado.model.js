// backend/src/db/models/gmailCorreoRevisado.model.js
// Correos de la casilla de reclutamiento que RRHH ya revisó (importados o
// descartados): evita que vuelvan a aparecer en cada análisis.
// Minimización (Ley 21.719): solo lo necesario para reconocer el correo; no
// guarda texto del CV ni respuestas de la IA.

const ESTADOS = { IMPORTADO: 'importado', DESCARTADO: 'descartado' }

module.exports = (sequelize, DataTypes) => {
  const GmailCorreoRevisado = sequelize.define(
    'gmail_correos_revisados',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      gmailMessageId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        unique: true,
        field: 'gmail_message_id',
      },

      estado: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: [Object.values(ESTADOS)] },
      },

      referidoId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'referido_id',
        references: { model: 'referidos', key: 'id' },
      },

      remitente: { type: DataTypes.STRING(255), allowNull: true },
      asunto: { type: DataTypes.STRING(255), allowNull: true },

      revisadoPorUsuarioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'revisado_por_usuario_id',
        references: { model: 'usuarios', key: 'id' },
      },
    },
    {
      tableName: 'gmail_correos_revisados',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  )

  GmailCorreoRevisado.ESTADOS = ESTADOS

  return GmailCorreoRevisado
}
