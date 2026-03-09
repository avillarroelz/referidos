// src/utils/hash.js
const bcrypt = require('bcryptjs')

module.exports = {
  hash: (plain) => bcrypt.hash(plain, 10),
  compare: (plain, hashed) => bcrypt.compare(plain, hashed),
}
