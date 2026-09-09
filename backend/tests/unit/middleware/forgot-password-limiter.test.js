// backend/tests/unit/middleware/forgot-password-limiter.test.js
// V23: forgot-password comparte contador con refresh.
//
// auth.routes.js monta forgot-password y reset-password con authRefreshLimiter,
// que son 20 por 15 minutos POR IP y es el mismo contador que usa /refresh. Dos
// consecuencias:
//
//   - se pueden disparar 20 correos de recuperacion cada 15 minutos contra el
//     buzon de un tercero, y quemar cuota SMTP de paso;
//   - abusar de una ruta degrada la otra: quien agota el limite enviando
//     recuperaciones deja sin renovar la sesion a los usuarios legitimos de esa
//     misma IP, que en una oficina con NAT son todos.
//
// El limitador propio cuenta por CORREO DESTINO ademas de por IP. Por correo,
// porque el daño concreto —el bombardeo del buzon— se dirige a una persona y no
// depende de desde donde se pida. Por IP, porque si no bastaria con rotar el
// correo destino para seguir enviando sin techo.

const express = require('express')
const request = require('supertest')

const limiters = jest.requireActual('../../../src/middleware/rateLimiters')

function appCon(...middlewares) {
  const app = express()
  app.set('trust proxy', true)
  app.use(express.json())
  app.use(...middlewares)
  app.post('/x', (_req, res) => res.json({ ok: true }))
  return app
}

const pedir = (app, { correo, ip = '9.9.9.9' } = {}) =>
  request(app).post('/x').set('X-Forwarded-For', ip).send(correo ? { correo } : {})

describe('V23: limitador propio de forgot-password', () => {
  describe('por correo destino', () => {
    it('corta los envios repetidos al mismo buzon', async () => {
      const app = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)

      const codigos = []
      for (let i = 0; i < 6; i++) {
        codigos.push((await pedir(app, { correo: 'victima@ecora.cl' })).status)
      }

      expect(codigos).toContain(429)
    })

    it('el limite de un correo no afecta a otro', async () => {
      const app = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)

      for (let i = 0; i < 6; i++) await pedir(app, { correo: 'victima2@ecora.cl' })
      const otro = await pedir(app, { correo: 'otra-persona@ecora.cl' })

      expect(otro.status).toBe(200)
    })
  })

  describe('por IP', () => {
    // Sin techo por IP bastaria con rotar el correo destino para seguir
    // enviando sin limite alguno.
    it('corta a una IP que rota el correo destino', async () => {
      const app = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)

      const codigos = []
      for (let i = 0; i < 25; i++) {
        codigos.push((await pedir(app, { correo: `objetivo${i}@ecora.cl`, ip: '203.0.113.80' })).status)
      }

      expect(codigos).toContain(429)
    })

    it('el limite de una IP no afecta a otra', async () => {
      const app = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)

      for (let i = 0; i < 25; i++) {
        await pedir(app, { correo: `x${i}@ecora.cl`, ip: '203.0.113.81' })
      }
      const otra = await pedir(app, { correo: 'legitimo@ecora.cl', ip: '198.51.100.9' })

      expect(otra.status).toBe(200)
    })
  })

  describe('independencia respecto de refresh', () => {
    // Es la mitad del problema: hoy comparten contador, asi que abusar de uno
    // deja al otro sin cuota.
    it('agotar forgot-password no consume la cuota de refresh', async () => {
      const forgot = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)
      const refresh = appCon(limiters.authRefreshLimiter)

      for (let i = 0; i < 25; i++) {
        await pedir(forgot, { correo: `y${i}@ecora.cl`, ip: '203.0.113.90' })
      }
      const res = await pedir(refresh, { ip: '203.0.113.90' })

      expect(res.status).toBe(200)
    })
  })

  describe('es mas estrecho que el que compartia con refresh', () => {
    it('permite menos envios por correo que los 20 de authRefreshLimiter', async () => {
      const app = appCon(limiters.forgotPasswordIpLimiter, limiters.forgotPasswordCorreoLimiter)

      const codigos = []
      for (let i = 0; i < 20; i++) {
        codigos.push((await pedir(app, { correo: 'conteo@ecora.cl' })).status)
      }

      const permitidos = codigos.filter(c => c === 200).length
      expect(permitidos).toBeLessThan(20)
    })
  })
})
