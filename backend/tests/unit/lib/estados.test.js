// backend/tests/unit/lib/estados.test.js

// Force strict mode for state transitions
process.env.DEBUG_TRANSITIONS = 'false'

// Clear the module cache to reload with new env
delete require.cache[require.resolve('../../../src/lib/estados')]

const { ESTADOS, DICTAMEN_ADC, puedePasar } = require('../../../src/lib/estados')

describe('Estados y Transiciones', () => {
  describe('ESTADOS', () => {
    it('debe definir exactamente 12 estados', () => {
      expect(Object.keys(ESTADOS)).toHaveLength(12)
    })

    it('debe incluir todos los estados esperados', () => {
      const expected = [
        'PENDIENTE', 'EN_REVISION', 'APROBADO_JEFE', 'LISTA_ESPERA',
        'ENVIADO_ADC', 'VALIDADO_ADC', 'RECHAZADO_ADC', 'CONTACTADO',
        'APROBADO', 'RECHAZADO', 'CONTRATADO', 'NO_CONTRATADO',
      ]
      expected.forEach(estado => {
        expect(ESTADOS[estado]).toBe(estado)
      })
    })
  })

  describe('DICTAMEN_ADC', () => {
    it('debe definir 3 dictámenes', () => {
      expect(Object.keys(DICTAMEN_ADC)).toHaveLength(3)
    })

    it('debe incluir CUMPLE, CUMPLE_PARCIAL, NO_CUMPLE', () => {
      expect(DICTAMEN_ADC.CUMPLE).toBe('CUMPLE')
      expect(DICTAMEN_ADC.CUMPLE_PARCIAL).toBe('CUMPLE_PARCIAL')
      expect(DICTAMEN_ADC.NO_CUMPLE).toBe('NO_CUMPLE')
    })
  })

  describe('puedePasar - transiciones válidas', () => {
    const transicionesValidas = [
      ['PENDIENTE', 'EN_REVISION'],
      ['PENDIENTE', 'RECHAZADO'],
      ['EN_REVISION', 'APROBADO_JEFE'],
      ['EN_REVISION', 'RECHAZADO'],
      ['EN_REVISION', 'LISTA_ESPERA'],
      ['APROBADO_JEFE', 'ENVIADO_ADC'],
      ['APROBADO_JEFE', 'CONTACTADO'],
      ['LISTA_ESPERA', 'APROBADO_JEFE'],
      ['ENVIADO_ADC', 'VALIDADO_ADC'],
      ['ENVIADO_ADC', 'RECHAZADO_ADC'],
      ['VALIDADO_ADC', 'CONTACTADO'],
      ['VALIDADO_ADC', 'APROBADO'],
      ['RECHAZADO_ADC', 'EN_REVISION'],
      ['CONTACTADO', 'APROBADO'],
      ['CONTACTADO', 'RECHAZADO'],
      ['APROBADO', 'CONTRATADO'],
      ['APROBADO', 'NO_CONTRATADO'],
    ]

    transicionesValidas.forEach(([desde, hacia]) => {
      it(`debe permitir ${desde} → ${hacia}`, () => {
        expect(puedePasar(desde, hacia)).toBe(true)
      })
    })
  })

  describe('puedePasar - transiciones inválidas', () => {
    const transicionesInvalidas = [
      ['PENDIENTE', 'APROBADO'],
      ['PENDIENTE', 'ENVIADO_ADC'],
      ['EN_REVISION', 'ENVIADO_ADC'],   // debe pasar por APROBADO_JEFE
      ['EN_REVISION', 'APROBADO'],
      ['EN_REVISION', 'VALIDADO_ADC'],
      ['APROBADO_JEFE', 'APROBADO'],
      ['LISTA_ESPERA', 'ENVIADO_ADC'],
      ['ENVIADO_ADC', 'PENDIENTE'],
      ['ENVIADO_ADC', 'APROBADO'],
      ['VALIDADO_ADC', 'RECHAZADO'],
      ['VALIDADO_ADC', 'PENDIENTE'],
      ['RECHAZADO_ADC', 'APROBADO'],
      ['CONTACTADO', 'PENDIENTE'],
      ['APROBADO', 'RECHAZADO'],
    ]

    transicionesInvalidas.forEach(([desde, hacia]) => {
      it(`debe rechazar ${desde} → ${hacia}`, () => {
        expect(puedePasar(desde, hacia)).toBe(false)
      })
    })
  })

  describe('estados terminales', () => {
    const terminales = ['RECHAZADO', 'CONTRATADO', 'NO_CONTRATADO']

    terminales.forEach(terminal => {
      it(`${terminal} no debe permitir ninguna transición`, () => {
        Object.values(ESTADOS).forEach(estado => {
          expect(puedePasar(terminal, estado)).toBe(false)
        })
      })
    })
  })

  describe('puedePasar - edge cases', () => {
    it('debe rechazar estado desconocido como origen', () => {
      expect(puedePasar('INEXISTENTE', 'PENDIENTE')).toBe(false)
    })

    it('debe rechazar estado desconocido como destino', () => {
      expect(puedePasar('PENDIENTE', 'INEXISTENTE')).toBe(false)
    })

    it('no debe permitir transición a sí mismo', () => {
      Object.values(ESTADOS).forEach(estado => {
        expect(puedePasar(estado, estado)).toBe(false)
      })
    })
  })
})
