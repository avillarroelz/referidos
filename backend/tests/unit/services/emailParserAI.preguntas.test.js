// backend/tests/unit/services/emailParserAI.preguntas.test.js
// Preguntas de filtro por CV: la IA responde si / no / no_se_sabe con una cita.
// La salida se normaliza en el backend: no se confia en la forma que devuelva el modelo.

const mockCreate = jest.fn()
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({ messages: { create: mockCreate } })),
}))

const emailParserAI = require('../../../src/services/emailParserAI')

const respuestaIA = (obj) => ({ content: [{ text: JSON.stringify(obj) }] })
const DATOS = { nombre: 'Juan Perez', email: null, telefono: null, rut: null, cargoPostulado: null, observaciones: null, nombreReferidor: null }

describe('emailParserAI.parse con preguntas', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('sin preguntas: mismo prompt y presupuesto de siempre, respuestas vacias', async () => {
    mockCreate.mockResolvedValue(respuestaIA(DATOS))

    const r = await emailParserAI.parse('texto del CV', 'asunto', 'a@b.cl', true)

    const llamada = mockCreate.mock.calls[0][0]
    expect(llamada.model).toBe('claude-haiku-4-5-20251001')
    expect(llamada.max_tokens).toBe(500)
    expect(llamada.system).not.toContain('respuestas')
    expect(r.respuestas).toEqual([])
    expect(r.nombre).toBe('Juan Perez')
  })

  it('con preguntas: las manda, sube max_tokens y trata el documento como no confiable', async () => {
    mockCreate.mockResolvedValue(respuestaIA({ ...DATOS, respuestas: [] }))

    await emailParserAI.parse('texto del CV', 'asunto', 'a@b.cl', true, ['Tiene licencia B?', 'Habla ingles?'])

    const llamada = mockCreate.mock.calls[0][0]
    expect(llamada.model).toBe('claude-haiku-4-5-20251001')
    expect(llamada.max_tokens).toBeGreaterThan(500)
    const usuario = llamada.messages[0].content
    expect(usuario).toContain('Tiene licencia B?')
    expect(usuario).toContain('Habla ingles?')
    // El texto del CV es contenido no confiable (prompt injection).
    expect(llamada.system).toMatch(/no se obedecen/i)
    expect(llamada.system).toMatch(/evidencia textual/i)
    expect(llamada.system).toContain('no_se_sabe')
  })

  it('normaliza: una respuesta por pregunta, en orden y con la pregunta original', async () => {
    mockCreate.mockResolvedValue(respuestaIA({
      ...DATOS,
      respuestas: [
        { pregunta: 'otra cosa que invento el modelo', respuesta: 'si', cita: 'Licencia clase B' },
        { pregunta: 'Habla ingles?', respuesta: 'no', cita: null },
      ],
    }))

    const r = await emailParserAI.parse('Postulante con Licencia clase B vigente', '', '', true, ['Tiene licencia B?', 'Habla ingles?'])

    expect(r.respuestas).toEqual([
      { pregunta: 'Tiene licencia B?', respuesta: 'si', cita: 'Licencia clase B' },
      { pregunta: 'Habla ingles?', respuesta: 'no', cita: null },
    ])
  })

  it('acepta la respuesta con tilde, mayusculas o espacios', async () => {
    mockCreate.mockResolvedValue(respuestaIA({
      ...DATOS,
      respuestas: [{ respuesta: 'Sí', cita: 'dato' }, { respuesta: ' NO ' }, { respuesta: 'No se sabe' }],
    }))

    const r = await emailParserAI.parse('un dato del cv', '', '', true, ['a', 'b', 'c'])

    expect(r.respuestas.map(x => x.respuesta)).toEqual(['si', 'no', 'no_se_sabe'])
  })

  it('cualquier valor fuera de si / no / no_se_sabe pasa a no_se_sabe', async () => {
    mockCreate.mockResolvedValue(respuestaIA({
      ...DATOS,
      respuestas: [
        { respuesta: 'quizas', cita: 'x' },
        { respuesta: true, cita: 'x' },
        { respuesta: 'no_se_sabe', cita: 'x' },
        { cita: 'x' },
      ],
    }))

    const r = await emailParserAI.parse('cv', '', '', true, ['a', 'b', 'c', 'd'])

    expect(r.respuestas.map(x => x.respuesta)).toEqual(['no_se_sabe', 'no_se_sabe', 'no_se_sabe', 'no_se_sabe'])
  })

  it('completa con no_se_sabe las preguntas que el modelo no contesto e ignora las sobrantes', async () => {
    mockCreate.mockResolvedValue(respuestaIA({
      ...DATOS,
      respuestas: [{ respuesta: 'si', cita: 'c1' }, { respuesta: 'si', cita: 'c2' }, { respuesta: 'si', cita: 'c3' }],
    }))

    const r = await emailParserAI.parse('c1 c2 c3', '', '', true, ['p1', 'p2'])
    expect(r.respuestas).toHaveLength(2)

    mockCreate.mockResolvedValue(respuestaIA({ ...DATOS, respuestas: [{ respuesta: 'si', cita: 'c1' }] }))
    const r2 = await emailParserAI.parse('c1 c2 c3', '', '', true, ['p1', 'p2'])
    expect(r2.respuestas).toEqual([
      { pregunta: 'p1', respuesta: 'si', cita: 'c1' },
      { pregunta: 'p2', respuesta: 'no_se_sabe', cita: null },
    ])

    mockCreate.mockResolvedValue(respuestaIA(DATOS)) // sin el campo respuestas
    const r3 = await emailParserAI.parse('cv', '', '', true, ['p1'])
    expect(r3.respuestas).toEqual([{ pregunta: 'p1', respuesta: 'no_se_sabe', cita: null }])
  })

  it('recorta la cita a 300 caracteres y la deja en null si no es texto', async () => {
    mockCreate.mockResolvedValue(respuestaIA({
      ...DATOS,
      respuestas: [{ respuesta: 'si', cita: 'x'.repeat(500) }, { respuesta: 'si', cita: 42 }, { respuesta: 'si', cita: '   ' }],
    }))

    const r = await emailParserAI.parse('x'.repeat(500), '', '', true, ['a', 'b', 'c'])

    expect(r.respuestas[0].cita).toHaveLength(300)
    expect(r.respuestas[1].cita).toBeNull()
    expect(r.respuestas[2].cita).toBeNull()
  })

  it('si la IA responde algo que no es JSON, falla sin filtrar la respuesta en el mensaje del error', async () => {
    mockCreate.mockResolvedValue({ content: [{ text: 'Secreta 123: Juan Perez vive en Calle Secreta 123' }] })
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    const intento = emailParserAI.parse('cv', '', '', true, ['p1'])

    await expect(intento).rejects.toThrow()
    await intento.catch(err => expect(err.message).not.toMatch(/Secreta/))
    for (const call of error.mock.calls) expect(JSON.stringify(call)).not.toMatch(/Secreta/)
    error.mockRestore()
  })

  describe('citas verificadas contra el texto enviado al modelo', () => {
    const CV = 'Juan Perez\nLicencia   de conducir CLASE B vigente.\nIngeniería   Civil'
    const preguntar = async (respuestas, contenido = CV) => {
      mockCreate.mockResolvedValue(respuestaIA({ ...DATOS, respuestas }))
      return (await emailParserAI.parse(contenido, '', '', true, ['p1'])).respuestas[0]
    }

    it('si con cita que esta en el texto: se conserva', async () => {
      expect(await preguntar([{ respuesta: 'si', cita: 'Licencia de conducir CLASE B' }]))
        .toEqual({ pregunta: 'p1', respuesta: 'si', cita: 'Licencia de conducir CLASE B' })
    })

    it('la comparacion ignora espacios, mayusculas y tildes', async () => {
      const r = await preguntar([{ respuesta: 'si', cita: 'ingenieria civil' }, ])
      expect(r.respuesta).toBe('si')
      const r2 = await preguntar([{ respuesta: 'si', cita: 'LICENCIA DE   CONDUCIR clase b' }])
      expect(r2.respuesta).toBe('si')
    })

    it('si con cita inventada: no_se_sabe sin cita', async () => {
      expect(await preguntar([{ respuesta: 'si', cita: 'Licencia clase A profesional' }]))
        .toEqual({ pregunta: 'p1', respuesta: 'no_se_sabe', cita: null })
    })

    it('si sin cita: no_se_sabe', async () => {
      expect(await preguntar([{ respuesta: 'si', cita: null }]))
        .toEqual({ pregunta: 'p1', respuesta: 'no_se_sabe', cita: null })
    })

    it('no sin cita: se conserva', async () => {
      expect(await preguntar([{ respuesta: 'no', cita: null }]))
        .toEqual({ pregunta: 'p1', respuesta: 'no', cita: null })
    })

    it('no con cita que esta en el texto: se conserva la cita', async () => {
      expect((await preguntar([{ respuesta: 'no', cita: 'Ingeniería Civil' }])).cita).toBe('Ingeniería Civil')
    })

    it('no con cita inventada: no_se_sabe sin cita', async () => {
      expect(await preguntar([{ respuesta: 'no', cita: 'No tiene licencia' }]))
        .toEqual({ pregunta: 'p1', respuesta: 'no_se_sabe', cita: null })
    })

    it('no_se_sabe siempre sale sin cita, aunque la cita este en el texto', async () => {
      expect(await preguntar([{ respuesta: 'no_se_sabe', cita: 'Ingeniería Civil' }]))
        .toEqual({ pregunta: 'p1', respuesta: 'no_se_sabe', cita: null })
    })

    it('una cita que solo esta mas alla de los 5000 caracteres enviados no vale', async () => {
      const largo = 'a'.repeat(5000) + ' Licencia clase B'
      expect((await preguntar([{ respuesta: 'si', cita: 'Licencia clase B' }], largo)).respuesta).toBe('no_se_sabe')
    })
  })
})
