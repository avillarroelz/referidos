// backend/tests/unit/services/pdfAnalyzerClient.test.js
const { analyzePdf } = require('../../../src/services/pdfAnalyzerClient')

describe('pdfAnalyzerClient ante respuestas que no son JSON', () => {
  const fetchOriginal = global.fetch
  afterEach(() => { global.fetch = fetchOriginal })

  // Un proxy o un contenedor a medio arrancar puede responder HTML o vacio.
  // El status tiene que sobrevivir para poder diagnosticar.
  it('conserva el status HTTP en el error', async () => {
    global.fetch = jest.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))

    await expect(analyzePdf(Buffer.from('%PDF-'))).rejects.toMatchObject({
      name: 'PdfAnalyzerError', status: 502,
    })
  })

  it('no incluye el cuerpo de la respuesta en el mensaje', async () => {
    global.fetch = jest.fn(async () => new Response('texto de un curriculum', { status: 200 }))

    const error = await analyzePdf(Buffer.from('%PDF-')).catch(e => e)

    expect(error.name).toBe('PdfAnalyzerError')
    expect(error.message).not.toContain('curriculum')
  })
})
