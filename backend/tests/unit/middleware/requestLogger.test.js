// backend/tests/unit/middleware/requestLogger.test.js
// redactBody decide que sale escrito en los logs del contenedor. Antes comparaba
// la clave de forma exacta contra una sola lista y no bajaba a los objetos
// anidados, asi que dejaba pasar en claro currentPassword, newPassword,
// credentials.refresh_token y los datos personales del candidato.
//
// La regla que fijan estas pruebas usa DOS listas, porque el criterio correcto
// no es el mismo para las dos clases de dato:
//
//   CREDENCIALES (password, token, secret, apikey): match por SUBCADENA,
//   insensible a mayusculas y a guiones bajos. Redactar de mas aqui no cuesta
//   nada y redactar de menos es una fuga, que es justo lo que paso.
//
//   DATOS PERSONALES (nombre, nombreReferidor, rut, correo, email, telefono,
//   observaciones): match EXACTO sobre una lista explicita. Por subcadena,
//   "nombre" se comeria nombreUnidad y nombreLinea, que no son datos de una
//   persona, y los logs de negocio dejarian de servir. Un campo personal nuevo
//   se agrega a la lista, que es una linea.
//
// Ambas se aplican RECURSIVAMENTE sobre objetos y arrays, y sin mutar el body
// original — el logger corre antes que los controllers y no puede estropear lo
// que la aplicacion va a leer despues.

const { redactBody } = require('../../../src/middleware/requestLogger')

const OCULTO = '[REDACTED]'

describe('redactBody', () => {
  describe('variantes del nombre de la clave', () => {
    it.each([
      'password',
      'currentPassword',
      'newPassword',
      'passwordConfirm',
      'PASSWORD',
    ])('debe redactar %s', (clave) => {
      const out = redactBody({ [clave]: 'Secreta12345!' })

      expect(out[clave]).toBe(OCULTO)
    })

    it.each([
      'token',
      'refresh_token',
      'access_token',
      'refreshToken',
      'apiKey',
      'api_key',
      'secret',
    ])('debe redactar %s', (clave) => {
      const out = redactBody({ [clave]: 'valor-sensible' })

      expect(out[clave]).toBe(OCULTO)
    })
  })

  describe('datos personales del candidato (Ley 21.719)', () => {
    it('debe redactar nombre, rut, correo, email, telefono y observaciones', () => {
      const out = redactBody({
        nombre: 'Juan Perez',
        rut: '12345678-9',
        correo: 'juan@ejemplo.cl',
        email: 'juan@ejemplo.cl',
        telefono: '+56912345678',
        observaciones: 'Vive cerca de la faena y viene recomendado',
      })

      expect(out).toEqual({
        nombre: OCULTO,
        rut: OCULTO,
        correo: OCULTO,
        email: OCULTO,
        telefono: OCULTO,
        observaciones: OCULTO,
      })
    })

    // El par que fija la diferencia entre las dos listas. Si alguien "simplifica"
    // los datos personales a match por subcadena, el segundo caso se pone rojo.
    it('debe redactar nombreReferidor, que esta en la lista por su nombre', () => {
      const out = redactBody({ nombreReferidor: 'Maria Soto' })

      expect(out.nombreReferidor).toBe(OCULTO)
    })

    it('NO debe redactar nombreUnidad ni nombreLinea, que no son datos de una persona', () => {
      const out = redactBody({ nombreUnidad: 'Operaciones Norte', nombreLinea: 'Mineria' })

      expect(out.nombreUnidad).toBe('Operaciones Norte')
      expect(out.nombreLinea).toBe('Mineria')
    })
  })

  describe('anidamiento', () => {
    // El caso real: POST /api/gmail/process y /preview mandan el refresh_token
    // de Gmail dentro de credentials.
    it('debe redactar dentro de objetos anidados', () => {
      const out = redactBody({
        query: 'subject:referido',
        credentials: { client_id: 'abc', refresh_token: '1//0hSECRETO' },
      })

      expect(out.credentials.refresh_token).toBe(OCULTO)
    })

    it('debe redactar dentro de arrays de objetos', () => {
      // POST /api/referidos/sync/gmail/manual manda un array de referidos.
      const out = redactBody({
        referidos: [
          { messageId: 'm1', nombre: 'Juan Perez', rut: '11111111-1' },
          { messageId: 'm2', nombre: 'Ana Diaz', rut: '22222222-2' },
        ],
      })

      expect(out.referidos[0].nombre).toBe(OCULTO)
      expect(out.referidos[0].rut).toBe(OCULTO)
      expect(out.referidos[1].nombre).toBe(OCULTO)
      // El messageId no es dato personal: debe sobrevivir para poder depurar.
      expect(out.referidos[0].messageId).toBe('m1')
    })

    it('debe redactar en varios niveles de profundidad', () => {
      const out = redactBody({ a: { b: { c: { password: 'Secreta12345!' } } } })

      expect(out.a.b.c.password).toBe(OCULTO)
    })
  })

  describe('lo que NO debe tocar', () => {
    it('debe conservar los campos sin dato sensible', () => {
      const out = redactBody({ estado: 'PENDIENTE', page: 2, mine: true })

      expect(out).toEqual({ estado: 'PENDIENTE', page: 2, mine: true })
    })

    it('debe devolver tal cual lo que no es objeto', () => {
      expect(redactBody(null)).toBeNull()
      expect(redactBody(undefined)).toBeUndefined()
      expect(redactBody('texto')).toBe('texto')
    })
  })

  describe('no debe mutar el body original', () => {
    // El logger corre antes que los controllers: si redactBody muta req.body,
    // la aplicacion deja de recibir los datos que necesita.
    it('deja intacto el objeto recibido, tambien en profundidad', () => {
      const original = {
        password: 'Secreta12345!',
        credentials: { refresh_token: '1//0hSECRETO' },
        referidos: [{ nombre: 'Juan Perez' }],
      }

      redactBody(original)

      expect(original.password).toBe('Secreta12345!')
      expect(original.credentials.refresh_token).toBe('1//0hSECRETO')
      expect(original.referidos[0].nombre).toBe('Juan Perez')
    })
  })
})
