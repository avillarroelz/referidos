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

  // DEBUG_TRANSITIONS es un interruptor que desactiva la maquina de estados
  // entera: con el encendido, cualquier estado conocido puede pasar a cualquier
  // otro. Nada mas en la suite lo cubria, asi que un despliegue con la variable
  // mal puesta no habria roto ninguna prueba.
  describe('modo laxo DEBUG_TRANSITIONS', () => {
    const valorOriginal = process.env.DEBUG_TRANSITIONS

    function cargarConDebug(valor) {
      jest.resetModules()
      if (valor === undefined) delete process.env.DEBUG_TRANSITIONS
      else process.env.DEBUG_TRANSITIONS = valor
      return require('../../../src/lib/estados')
    }

    afterAll(() => {
      jest.resetModules()
      process.env.DEBUG_TRANSITIONS = valorOriginal
    })

    it.each([
      ['sin la variable definida', undefined],
      ['con la variable vacia', ''],
      ['con "false"', 'false'],
      ['con "TRUE" en mayusculas', 'TRUE'],
      ['con "1"', '1'],
      ['con "yes"', 'yes'],
    ])('%s rigen las reglas estrictas', (_etiqueta, valor) => {
      const { puedePasar: pasar } = cargarConDebug(valor)
      expect(pasar('PENDIENTE', 'APROBADO')).toBe(false)
      expect(pasar('PENDIENTE', 'EN_REVISION')).toBe(true)
    })

    it('solo el literal "true" activa el modo laxo', () => {
      const consola = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const { puedePasar: pasar } = cargarConDebug('true')

      expect(pasar('PENDIENTE', 'APROBADO')).toBe(true)
      expect(pasar('CONTRATADO', 'PENDIENTE')).toBe(true)

      consola.mockRestore()
    })

    // Ni siquiera el modo laxo puede inventar estados: si lo hiciera, un typo en
    // el cliente escribiria un estado inexistente en la base.
    it('el modo laxo sigue rechazando estados desconocidos', () => {
      const consola = jest.spyOn(console, 'warn').mockImplementation(() => {})
      const { puedePasar: pasar } = cargarConDebug('true')

      expect(pasar('PENDIENTE', 'INEXISTENTE')).toBe(false)
      expect(pasar('INEXISTENTE', 'PENDIENTE')).toBe(false)
      expect(consola).toHaveBeenCalled()

      consola.mockRestore()
    })
  })

  // Invariantes de la maquina, para que agregar un estado nuevo obligue a
  // conectarlo en vez de dejarlo suelto.
  describe('invariantes de la maquina de estados', () => {
    const TERMINALES = ['RECHAZADO', 'CONTRATADO', 'NO_CONTRATADO']
    const lista = Object.values(ESTADOS)

    it('todo estado no terminal tiene al menos una salida', () => {
      const sinSalida = lista
        .filter(e => !TERMINALES.includes(e))
        .filter(e => !lista.some(destino => puedePasar(e, destino)))
      expect(sinSalida).toEqual([])
    })

    it('todo estado excepto el inicial tiene al menos una entrada', () => {
      const sinEntrada = lista
        .filter(e => e !== 'PENDIENTE')
        .filter(e => !lista.some(origen => puedePasar(origen, e)))
      expect(sinEntrada).toEqual([])
    })

    it('todo estado es alcanzable desde PENDIENTE', () => {
      const visitados = new Set(['PENDIENTE'])
      const cola = ['PENDIENTE']
      while (cola.length) {
        const actual = cola.shift()
        for (const destino of lista) {
          if (!visitados.has(destino) && puedePasar(actual, destino)) {
            visitados.add(destino)
            cola.push(destino)
          }
        }
      }
      expect(lista.filter(e => !visitados.has(e))).toEqual([])
    })

    it('desde todo estado se puede llegar a un terminal', () => {
      const alcanza = (origen, visto = new Set()) => {
        if (TERMINALES.includes(origen)) return true
        if (visto.has(origen)) return false
        visto.add(origen)
        return lista.some(d => puedePasar(origen, d) && alcanza(d, visto))
      }
      // jest no admite un segundo argumento en expect(), asi que el detalle del
      // estado culpable se conserva juntando los que fallan.
      const sinSalidaATerminal = lista.filter(e => !alcanza(e))
      expect(sinSalidaATerminal).toEqual([])
    })
  })
})
