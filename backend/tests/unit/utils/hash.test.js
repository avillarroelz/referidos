// backend/tests/unit/utils/hash.test.js
const { hash, compare } = require('../../../src/utils/hash')

describe('Hash Utils', () => {
  describe('hash', () => {
    it('debe generar un hash bcrypt', async () => {
      const hashed = await hash('password123')
      expect(hashed).toBeDefined()
      expect(typeof hashed).toBe('string')
      expect(hashed).not.toBe('password123')
    })

    it('debe generar hashes diferentes para el mismo input (salt)', async () => {
      const hash1 = await hash('password123')
      const hash2 = await hash('password123')
      expect(hash1).not.toBe(hash2)
    })

    it('el hash debe empezar con $2a$ o $2b$ (bcrypt)', async () => {
      const hashed = await hash('test')
      expect(hashed).toMatch(/^\$2[ab]\$/)
    })
  })

  describe('compare', () => {
    it('debe retornar true para contraseña correcta', async () => {
      const hashed = await hash('mypassword')
      const result = await compare('mypassword', hashed)
      expect(result).toBe(true)
    })

    it('debe retornar false para contraseña incorrecta', async () => {
      const hashed = await hash('mypassword')
      const result = await compare('wrongpassword', hashed)
      expect(result).toBe(false)
    })

    it('debe retornar false para string vacío vs hash', async () => {
      const hashed = await hash('mypassword')
      const result = await compare('', hashed)
      expect(result).toBe(false)
    })
  })
})
