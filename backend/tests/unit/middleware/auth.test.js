// backend/tests/unit/middleware/auth.test.js
process.env.JWT_SECRET = 'test-secret'
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret'

const { generateAccessToken } = require('../../../src/utils/jwt')

// Mock getModel (not used directly in auth middleware for authRequired/requireRoles)
jest.mock('../../../src/db', () => ({
  getModel: jest.fn(),
}))

const { authRequired, requireRoles, authOptional } = require('../../../src/middleware/auth')

// Helper to create mock Express req/res/next
function mockReqResNext(overrides = {}) {
  const req = {
    header: jest.fn(() => null),
    query: {},
    ...overrides,
  }
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }
  const next = jest.fn()
  return { req, res, next }
}

describe('Auth Middleware', () => {
  const userPayload = { id: 1, correo: 'test@example.com', roles: ['TRABAJADOR'] }

  describe('authRequired', () => {
    it('debe retornar 401 si no hay token', () => {
      const { req, res, next } = mockReqResNext()
      authRequired(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Token no proporcionado' })
      expect(next).not.toHaveBeenCalled()
    })

    it('debe retornar 401 si el token es inválido', () => {
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => 'Bearer invalid-token'),
      })
      authRequired(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido o expirado' })
      expect(next).not.toHaveBeenCalled()
    })

    it('debe aceptar un token válido en Authorization header', () => {
      const token = generateAccessToken(userPayload)
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => `Bearer ${token}`),
      })
      authRequired(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth).toBeDefined()
      expect(req.auth.id).toBe(1)
      expect(req.auth.correo).toBe('test@example.com')
      expect(req.auth.roles).toEqual(['TRABAJADOR'])
    })

    it('debe aceptar token por query string', () => {
      const token = generateAccessToken(userPayload)
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => null),
        query: { token },
      })
      authRequired(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth.id).toBe(1)
    })

    it('debe adjuntar roles vacíos si el token no tiene roles', () => {
      const token = generateAccessToken({ id: 2, correo: 'no-roles@test.com' })
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => `Bearer ${token}`),
      })
      authRequired(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth.roles).toEqual([])
    })
  })

  describe('requireRoles', () => {
    it('debe retornar 401 si no hay auth', async () => {
      const middleware = requireRoles('ADMIN')
      const { req, res, next } = mockReqResNext()
      await middleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('debe retornar 403 si el usuario no tiene el rol requerido', async () => {
      const middleware = requireRoles('ADMIN')
      const { req, res, next } = mockReqResNext()
      req.auth = { id: 1, roles: ['TRABAJADOR'] }
      await middleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Sin permisos suficientes',
          required: ['ADMIN'],
          current: ['TRABAJADOR'],
        })
      )
    })

    it('debe permitir acceso si tiene el rol requerido', async () => {
      const middleware = requireRoles('ADMIN')
      const { req, res, next } = mockReqResNext()
      req.auth = { id: 1, roles: ['ADMIN'] }
      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('debe permitir si tiene al menos uno de los roles', async () => {
      const middleware = requireRoles('RRHH', 'ADMIN')
      const { req, res, next } = mockReqResNext()
      req.auth = { id: 1, roles: ['RRHH'] }
      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('debe rechazar si no tiene ninguno de los roles requeridos', async () => {
      const middleware = requireRoles('RRHH', 'ADMIN')
      const { req, res, next } = mockReqResNext()
      req.auth = { id: 1, roles: ['TRABAJADOR'] }
      await middleware(req, res, next)
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })

  describe('authOptional', () => {
    it('debe continuar sin token', () => {
      const { req, res, next } = mockReqResNext()
      authOptional(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth).toBeUndefined()
    })

    it('debe adjuntar auth si hay token válido', () => {
      const token = generateAccessToken(userPayload)
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => `Bearer ${token}`),
      })
      authOptional(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth).toBeDefined()
      expect(req.auth.id).toBe(1)
    })

    it('debe continuar sin auth si el token es inválido', () => {
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => 'Bearer invalid-token'),
      })
      authOptional(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth).toBeUndefined()
    })

    it('debe ignorar header que no empieza con Bearer', () => {
      const { req, res, next } = mockReqResNext({
        header: jest.fn(() => 'Basic sometoken'),
      })
      authOptional(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.auth).toBeUndefined()
    })
  })
})
