// backend/tests/unit/utils/jwt.test.js
const jwt = require('jsonwebtoken')

// El setup global ya fija estos valores; se repiten aquí para que el archivo
// sea legible por sí solo y no dependa del orden de carga.
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

const ACCESS_SECRET = 'test-secret'
const REFRESH_SECRET = 'test-refresh-secret'

describe('JWT Utils', () => {
  const payload = { id: 1, correo: 'test@example.com', roles: ['TRABAJADOR'] }

  describe('generateAccessToken', () => {
    it('debe generar un token JWT con tres segmentos', () => {
      const token = generateAccessToken(payload)
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3)
    })

    it('debe conservar el payload', () => {
      const decoded = jwt.decode(generateAccessToken(payload))
      expect(decoded.id).toBe(payload.id)
      expect(decoded.correo).toBe(payload.correo)
      expect(decoded.roles).toEqual(payload.roles)
    })

    it('debe fechar y expirar el token', () => {
      const decoded = jwt.decode(generateAccessToken(payload))
      expect(decoded.iat).toBeDefined()
      expect(decoded.exp).toBeDefined()
      expect(decoded.exp).toBeGreaterThan(decoded.iat)
    })

    it('debe firmar con el algoritmo configurado, no con "none"', () => {
      const { header } = jwt.decode(generateAccessToken(payload), { complete: true })
      expect(header.alg).toBe('HS256')
    })

    // Un access token de larga duración anula el sentido del refresh: si se
    // filtra, sirve durante horas o días.
    it('el access token debe durar bastante menos que el refresh', () => {
      const acceso = jwt.decode(generateAccessToken(payload))
      const refresco = jwt.decode(generateRefreshToken(payload))
      expect(acceso.exp - acceso.iat).toBeLessThan(refresco.exp - refresco.iat)
    })
  })

  describe('generateRefreshToken', () => {
    it('debe firmarse con un secreto distinto al del access token', () => {
      const token = generateRefreshToken(payload)
      expect(() => jwt.verify(token, ACCESS_SECRET)).toThrow()
      expect(jwt.verify(token, REFRESH_SECRET).id).toBe(payload.id)
    })
  })

  describe('verifyAccessToken', () => {
    it('debe aceptar un token propio y devolver el payload', () => {
      const result = verifyAccessToken(generateAccessToken(payload))
      expect(result.valid).toBe(true)
      expect(result.decoded.id).toBe(payload.id)
      expect(result.decoded.correo).toBe(payload.correo)
      expect(result.decoded.roles).toEqual(payload.roles)
    })

    it('debe rechazar un token con firma inválida', () => {
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '1h' })
      expect(verifyAccessToken(token).valid).toBe(false)
    })

    it('debe rechazar un token expirado', () => {
      const token = jwt.sign(payload, ACCESS_SECRET, { expiresIn: '-1s' })
      const result = verifyAccessToken(token)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('debe rechazar un token que aún no es válido (nbf futuro)', () => {
      const ahora = Math.floor(Date.now() / 1000)
      const token = jwt.sign({ ...payload, nbf: ahora + 3600 }, ACCESS_SECRET)
      expect(verifyAccessToken(token).valid).toBe(false)
    })

    // El ataque clásico contra JWT: cambiar el header a alg=none y quitar la
    // firma. Solo se frena si la verificación fija la lista de algoritmos.
    it('debe rechazar un token con alg="none"', () => {
      const sinFirma =
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
        '.' +
        Buffer.from(JSON.stringify(payload)).toString('base64url') +
        '.'
      expect(verifyAccessToken(sinFirma).valid).toBe(false)
    })

    it('debe rechazar un token firmado con otro algoritmo HMAC', () => {
      const token = jwt.sign(payload, ACCESS_SECRET, { algorithm: 'HS512', expiresIn: '1h' })
      expect(verifyAccessToken(token).valid).toBe(false)
    })

    // Escalada de privilegios: alterar los roles del payload sin poder
    // refirmar debe invalidar el token entero.
    it('debe rechazar un token cuyo payload fue alterado', () => {
      const token = generateAccessToken(payload)
      const [header, , firma] = token.split('.')
      const alterado = Buffer.from(
        JSON.stringify({ ...payload, roles: ['ADMIN'] })
      ).toString('base64url')

      const result = verifyAccessToken(`${header}.${alterado}.${firma}`)

      expect(result.valid).toBe(false)
    })

    it('no debe aceptar un refresh token como access token', () => {
      expect(verifyAccessToken(generateRefreshToken(payload)).valid).toBe(false)
    })

    it.each([
      ['una cadena basura', 'not-a-token'],
      ['una cadena vacía', ''],
      ['null', null],
      ['undefined', undefined],
      ['un objeto', {}],
      ['solo dos segmentos', 'aaa.bbb'],
    ])('debe rechazar %s sin lanzar excepción', (_etiqueta, entrada) => {
      const result = verifyAccessToken(entrada)
      expect(result.valid).toBe(false)
      expect(typeof result.error).toBe('string')
    })

    // El mensaje de error viaja a las respuestas del API: filtrar el secreto
    // ahí sería entregar la llave.
    it('el mensaje de error no debe contener el secreto', () => {
      const result = verifyAccessToken('not-a-token')
      expect(result.error).not.toContain(ACCESS_SECRET)
      expect(result.error).not.toContain(REFRESH_SECRET)
    })
  })

  describe('verifyRefreshToken', () => {
    it('debe aceptar un refresh token propio', () => {
      const result = verifyRefreshToken(generateRefreshToken(payload))
      expect(result.valid).toBe(true)
      expect(result.decoded.id).toBe(payload.id)
    })

    it('no debe validar un access token como refresh token', () => {
      expect(verifyRefreshToken(generateAccessToken(payload)).valid).toBe(false)
    })

    it('debe rechazar un token con firma inválida', () => {
      const token = jwt.sign(payload, 'wrong-secret', { expiresIn: '7d' })
      expect(verifyRefreshToken(token).valid).toBe(false)
    })

    it('debe rechazar un refresh token expirado', () => {
      const token = jwt.sign(payload, REFRESH_SECRET, { expiresIn: '-1s' })
      expect(verifyRefreshToken(token).valid).toBe(false)
    })

    it('debe rechazar un token con alg="none"', () => {
      const sinFirma =
        Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
        '.' +
        Buffer.from(JSON.stringify(payload)).toString('base64url') +
        '.'
      expect(verifyRefreshToken(sinFirma).valid).toBe(false)
    })
  })

  describe('generateTokens', () => {
    it('debe entregar ambos tokens, distintos y verificables cada uno por su lado', () => {
      const { accessToken, refreshToken } = generateTokens(payload)

      expect(accessToken).not.toBe(refreshToken)
      expect(verifyAccessToken(accessToken).valid).toBe(true)
      expect(verifyRefreshToken(refreshToken).valid).toBe(true)
      expect(verifyAccessToken(refreshToken).valid).toBe(false)
      expect(verifyRefreshToken(accessToken).valid).toBe(false)
    })

    it('ambos tokens llevan el mismo sujeto', () => {
      const { accessToken, refreshToken } = generateTokens(payload)
      expect(jwt.decode(accessToken).id).toBe(jwt.decode(refreshToken).id)
    })
  })
})
