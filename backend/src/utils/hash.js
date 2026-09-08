// src/utils/hash.js
const bcrypt = require('bcryptjs')

module.exports = {
  hash: (plain) => bcrypt.hash(plain, 12),
  // Las cuentas creadas por OAuth no tienen hash local. bcrypt.compare LANZA
  // con null o undefined ("Illegal arguments"), y ese throw termina en un 500
  // que delata la existencia de la cuenta. Sin hash no hay coincidencia posible:
  // la respuesta correcta es false, no una excepcion.
  compare: (plain, hashed) => {
    if (!hashed) return Promise.resolve(false)
    return bcrypt.compare(plain, hashed)
  },
}
