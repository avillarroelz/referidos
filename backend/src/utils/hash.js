// src/utils/hash.js
const bcrypt = require('bcryptjs')

module.exports = {
  hash: (plain) => bcrypt.hash(plain, 12),
  // Las cuentas creadas por OAuth no tienen hash local. bcrypt.compare LANZA
  // con null o undefined ("Illegal arguments"), y ese throw termina en un 500
  // que delata la existencia de la cuenta. Sin hash no hay coincidencia posible:
  // la respuesta correcta es false, no una excepcion.
  compare: (plain, hashed) => {
    // Falta cualquiera de los dos -> no hay coincidencia posible. Se compara
    // `plain` contra null y no por falsedad: la cadena vacia es una contraseña
    // valida y compare('', hash('')) debe seguir dando true.
    if (plain == null || !hashed) return Promise.resolve(false)
    return bcrypt.compare(plain, hashed)
  },
}
