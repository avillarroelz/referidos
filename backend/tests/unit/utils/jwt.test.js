// backend/tests/unit/utils/jwt.test.js
const jwt = require('jsonwebtoken')

// Set env before importing
process.env.JWT_SECRET = 'test-secret'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'
process.env.JWT_EXPIRES_IN = '1h'
process.env.JWT_REFRESH_EXPIRES_IN = '7d'

const {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokens,
} = require('../../../src/utils/jwt')

describe('JWT Utils', () => {
  const payload = { id: 1, correo: 'test@example.com', roles: ['TRABAJADOR'] }

  describe('generateAccessToken', () => {
    it('debe generar un token JWT válido', () => {
      const token = generateAccessToken(payload)
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)
    })

    it('debe contener el payload correcto', () => {
      const token = generateAccessToken(payload)
      const decoded = jwt.decode(token)
      expect(decoded.id).toBe(payload.id)
      expect(decoded.correo).toBe(payload.correo)
      expect(decoded.roles).toEqual(payload.roles)
    })

    it('debe incluir exp en el token', () => {
      const token = generateAccessToken(payload)
      const decoded = jwt.decode(token)
      expect(decoded.exp).toBeDefined()
      expect(decoded.iat).toBeDefined()
    })
  })

  describe('generateRefreshToken', () => {
    it('debe generar un refresh token válido', () => {
      const token = generateRefreshToken(payload)
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
    })

    it('debe usar un secret diferente al access token', () => {
      const accessToken = generateAccessToken(payload)
      const refreshToken = generateRefreshToken(payload)
      expect(accessToken).not.toBe(refreshToken)
    })
  })

  describe('verifyAccessToken', () => {
    it('debe verificar un token válido', () => {
      const token = generateAccessToken(payload)
      const result = verifyAccessToken(token)
      expect(result.valid).toBe(true)
      expect(result.decoded.id).toBe(payload.id)
      expect(result.decoded.correo).toBe(payload.correo)
    })

    it('debe rechazar un token con firma inválida', () => {
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' })
      const result = verifyAccessToken(token)
      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('debe rechazar un token expirado', () => {
      const token = jwt.sign(payload, 'test-secret', { expiresIn: '0s' })
      const result = verifyAccessToken(token)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('debe rechazar un string basura', () => {
      const result = verifyAccessToken('not-a-token')
      expect(result.valid).toBe(false)
    })
  })

  describe('verifyRefreshToken', () => {
    it('debe verificar un refresh token válido', () => {
      const token = generateRefreshToken(payload)
      const result = verifyRefreshToken(token)
      expect(result.valid).toBe(true)
      expect(result.decoded.id).toBe(payload.id)
    })

    it('no debe validar un access token como refresh token', () => {
      const token = generateAccessToken(payload)
      const result = verifyRefreshToken(token)
      expect(result.valid).toBe(false)
    })

    it('debe rechazar un token con firma inválida', () => {
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '7d' })
      const result = verifyRefreshToken(token)
      expect(result.valid).toBe(false)
    })
  })

  describe('generateTokens', () => {
    it('debe generar ambos tokens', () => {
      const tokens = generateTokens(payload)
      expect(tokens.accessToken).toBeDefined()
      expect(tokens.refreshToken).toBeDefined()
    })

    it('access y refresh token deben ser diferentes', () => {
      const tokens = generateTokens(payload)
      expect(tokens.accessToken).not.toBe(tokens.refreshToken)
    })

    it('ambos tokens deben ser verificables', () => {
      const tokens = generateTokens(payload)
      expect(verifyAccessToken(tokens.accessToken).valid).toBe(true)
      expect(verifyRefreshToken(tokens.refreshToken).valid).toBe(true)
    })
  })
})
