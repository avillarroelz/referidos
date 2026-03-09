// backend/tests/helpers/factories.js
// Factories para generar datos de prueba con @faker-js/faker
const { faker } = require('@faker-js/faker');

/**
 * Construye un objeto de datos para Referido (sin guardar en BD).
 *
 * @param {Object} [overrides={}] - campos a sobreescribir
 * @returns {Object} datos del referido
 */
function buildReferido(overrides = {}) {
  return {
    nombre: faker.person.fullName(),
    rut: `${faker.number.int({ min: 10000000, max: 99999999 })}-${faker.string.alpha({ length: 1, casing: 'upper' })}`,
    telefono: `+569${faker.string.numeric(8)}`,
    email: faker.internet.email(),
    cargoPostulado: faker.person.jobTitle(),
    observaciones: faker.lorem.sentence(),
    nombreReferidor: faker.person.fullName(),
    estado: 'PENDIENTE',
    enviadoADC: false,
    origenPublico: false,
    ...overrides,
  };
}

/**
 * Construye un objeto de datos para Usuario (sin guardar en BD).
 *
 * @param {Object} [overrides={}] - campos a sobreescribir
 * @returns {Object} datos del usuario
 */
function buildUsuario(overrides = {}) {
  return {
    username: faker.internet.username(),
    correo: faker.internet.email(),
    password: faker.internet.password({ length: 12 }),
    estado: true,
    auth_provider: 'local',
    ...overrides,
  };
}

/**
 * Crea y guarda un Referido en la base de datos de testing.
 * Requiere que exista al menos un usuario (creadoPorUserId es obligatorio).
 *
 * @param {Function} getModel - funcion para obtener modelos
 * @param {Object} [overrides={}] - campos a sobreescribir
 * @returns {Promise<Object>} instancia de Referido creada
 */
async function createReferido(getModel, overrides = {}) {
  const Referido = getModel('Referido');
  const data = buildReferido(overrides);
  return Referido.create(data);
}

/**
 * Crea y guarda un Usuario en la base de datos de testing.
 * El password se guarda en texto plano (sin hash) por simplicidad en factories.
 * Para tests de autenticacion, usa helpers/auth.js que hashea correctamente.
 *
 * @param {Function} getModel - funcion para obtener modelos
 * @param {Object} [overrides={}] - campos a sobreescribir
 * @returns {Promise<Object>} instancia de Usuario creada
 */
async function createUsuario(getModel, overrides = {}) {
  const Usuario = getModel('Usuario');
  const data = buildUsuario(overrides);
  return Usuario.create(data);
}

module.exports = { buildReferido, buildUsuario, createReferido, createUsuario };
