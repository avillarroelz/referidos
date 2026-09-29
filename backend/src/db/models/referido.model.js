// backend/src/db/models/referido.model.js
const { Op } = require('sequelize')
const { ESTADOS } = require('../../lib/estados')

module.exports = (sequelize, DataTypes) => {
  const Referido = sequelize.define(
    'referido',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

      // Datos del referido (persona referenciada)
      nombre: { type: DataTypes.STRING(180), allowNull: false },
      // RUT NO es único: la misma persona puede postular a varios cargos
      // (o ser referida y luego auto-postular). Las búsquedas por RUT usan un índice no único.
      rut: { type: DataTypes.STRING(20), allowNull: true },
      telefono: { type: DataTypes.STRING(30), allowNull: true },
      email: { type: DataTypes.STRING(180), allowNull: true, validate: { isEmail: true } },
      cargoPostulado: { type: DataTypes.STRING(180), allowNull: true, field: 'cargo_postulado' },
      observaciones: { type: DataTypes.TEXT, allowNull: true },

      // Nombre del referidor (persona que hace la referencia)
      nombreReferidor: {
        type: DataTypes.STRING(180),
        allowNull: true,
        field: 'nombre_referidor'
      },

      // Estado BPM — STRING para flexibilidad (evita problemas de migración ENUM en PostgreSQL)
      estado: {
        type: DataTypes.STRING(30),
        allowNull: false,
        defaultValue: ESTADOS.PENDIENTE,
        validate: { isIn: [Object.values(ESTADOS)] },
      },

      // Marca legacy para ADC (mantenida por compatibilidad)
      enviadoADC: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'enviado_adc',
      },

      // Usuario creador
      creadoPorUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'creado_por_usuario_id',
        references: { model: 'usuarios', key: 'id' },
      },

      // Usuario postulante (cuando un externo se postula a sí mismo estando logueado)
      postulanteUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'postulante_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      // Unidad de negocio
      unidadNegocioId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'unidad_negocio_id',
        references: { model: 'unidad_negocio', key: 'id' },
      },

      // ── Nuevos campos para flujo ADC ──

      // ADC asignado
      asignadoADCUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: 'asignado_adc_user_id',
        references: { model: 'usuarios', key: 'id' },
      },

      // Dictamen del ADC
      dictamenADC: {
        type: DataTypes.STRING(30),
        allowNull: true,
        field: 'dictamen_adc',
      },

      // Fechas de control ADC
      fechaEnvioADC: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'fecha_envio_adc',
      },

      fechaRespuestaADC: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'fecha_respuesta_adc',
      },

      // SLA deadline para respuesta del ADC
      slaDeadline: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'sla_deadline',
      },

      // Indica si fue creado desde el formulario público
      origenPublico: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: 'origen_publico',
      },

      // Correo de Gmail del que se importó: hace idempotente el import
      gmailMessageId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        field: 'gmail_message_id',
      },
    },
    {
      tableName: 'referidos',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['creado_por_usuario_id'] },
        { fields: ['postulante_user_id'] },
        { fields: ['rut'] },
        { fields: ['estado'] },
        { fields: ['enviado_adc'] },
        { fields: ['unidad_negocio_id'] },
        { fields: ['asignado_adc_user_id'] },
        { fields: ['sla_deadline'] },
        {
          name: 'referidos_gmail_message_id_unique',
          unique: true,
          fields: ['gmail_message_id'],
          where: { gmail_message_id: { [Op.ne]: null } },
        },
      ],
    }
  )

  return Referido
}
