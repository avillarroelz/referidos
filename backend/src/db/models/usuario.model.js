// backend/src/db/models/usuario.model.js
module.exports = (sequelize, DataTypes) => {
  const Usuario = sequelize.define(
    'usuario',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      username: { type: DataTypes.STRING(100), allowNull: false },
      correo: { type: DataTypes.STRING(150), allowNull: false, unique: true, validate: { isEmail: true } },
      password: { type: DataTypes.STRING(200), allowNull: true }, // hash bcrypt - ahora nullable para OAuth
      estado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      last_login: { type: DataTypes.DATE, allowNull: true },

      // Account lockout (OWASP A07)
      failedAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'failed_attempts' },
      lockedUntil: { type: DataTypes.DATE, allowNull: true, field: 'locked_until' },

      // Password reset
      resetToken: { type: DataTypes.STRING(255), allowNull: true, field: 'reset_token' },
      resetTokenExpires: { type: DataTypes.DATE, allowNull: true, field: 'reset_token_expires' },

      // Campos para OAuth2 (Google)
      google_id: { type: DataTypes.STRING(255), allowNull: true, unique: true },
      google_refresh_token: { type: DataTypes.TEXT, allowNull: true },
      profile_picture: { type: DataTypes.STRING(500), allowNull: true },
      auth_provider: {
        type: DataTypes.ENUM('local', 'google'),
        allowNull: false,
        defaultValue: 'local'
      }
    },
    {
      tableName: 'usuarios',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at'
    }
  )

  // Asociaciones se definen externamente (associate.js)
  return Usuario
}
