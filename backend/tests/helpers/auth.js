// backend/tests/helpers/auth.js
// Utilidades de autenticacion para tests
const { hash } = require('../../src/utils/hash');
const { generateAccessToken } = require('../../src/utils/jwt');

/**
 * Crea los 4 roles base del sistema: TRABAJADOR, RRHH, ADMIN, ADC.
 * Retorna un objeto { TRABAJADOR, RRHH, ADMIN, ADC } con las instancias creadas.
 *
 * @param {Function} getModel - funcion para obtener modelos por alias
 * @returns {Promise<Object>} roles creados
 */
async function seedRoles(getModel) {
  const Rol = getModel('Rol');
  const nombres = ['TRABAJADOR', 'RRHH', 'ADMIN', 'ADC'];
  const roles = {};

  for (const nombre of nombres) {
    const [rol] = await Rol.findOrCreate({
      where: { nombre },
      defaults: { nombre, descripcion: `Rol ${nombre} para testing` },
    });
    roles[nombre] = rol;
  }

  return roles;
}

/**
 * Crea un usuario de prueba con password hasheado y roles asignados.
 *
 * @param {Function} getModel - funcion para obtener modelos por alias
 * @param {Object} options
 * @param {string} options.username - nombre de usuario
 * @param {string} options.correo - correo electronico
 * @param {string} [options.password='Test123!'] - password en texto plano
 * @param {string[]} [options.roles=[]] - nombres de roles a asignar (ej: ['ADMIN', 'RRHH'])
 * @returns {Promise<Object>} usuario creado con roles asignados
 */
async function createTestUser(getModel, { username, correo, password = 'Test123!', roles = [] }) {
  const Usuario = getModel('Usuario');
  const Rol = getModel('Rol');
  const UsuarioRol = getModel('UsuarioRol');

  // Crear usuario con password hasheado
  const hashedPassword = await hash(password);
  const usuario = await Usuario.create({
    username,
    correo,
    password: hashedPassword,
    estado: true,
    auth_provider: 'local',
  });

  // Asignar roles
  if (roles.length > 0) {
    for (const rolName of roles) {
      const rol = await Rol.findOne({ where: { nombre: rolName } });
      if (rol) {
        await UsuarioRol.create({
          usuarioId: usuario.id,
          rolId: rol.id,
        });
      }
    }
  }

  // Recargar con roles
  const userWithRoles = await Usuario.findByPk(usuario.id, {
    include: [{ model: Rol, as: 'roles' }],
  });

  return userWithRoles;
}

/**
 * Genera un JWT access token para un usuario de prueba.
 *
 * @param {Object} user - instancia del modelo Usuario (con roles cargados)
 * @returns {string} JWT token
 */
function getAuthToken(user) {
  const roles = user.roles ? user.roles.map((r) => r.nombre) : [];
  return generateAccessToken({
    id: user.id,
    username: user.username,
    correo: user.correo,
    roles,
  });
}

/**
 * Retorna el header Authorization listo para usar en supertest.
 *
 * @param {Object} user - instancia del modelo Usuario
 * @returns {{ Authorization: string }}
 */
function authHeader(user) {
  return { Authorization: `Bearer ${getAuthToken(user)}` };
}

module.exports = { seedRoles, createTestUser, getAuthToken, authHeader };
