// backend/tests/unit/services/gmailService.pdf.test.js
// El texto de los CV en PDF lo extrae el sidecar Rust (services/pdf-analyzer),
// no una libreria dentro del proceso del backend.
const gmailService = require('../../../src/services/gmailService')

describe('gmailService.extractTextFromFile con PDF', () => {
  const original = gmailService.pdfAnalyzer
  afterEach(() => { gmailService.pdfAnalyzer = original })

  it('devuelve el texto de todas las paginas que entrega el analizador', async () => {
    const analyzePdf = jest.fn(async () => ({
      pages: 2,
      text: [{ page: 1, text: 'Juan Perez' }, { page: 2, text: 'Soldador calificado' }],
    }))
    gmailService.pdfAnalyzer = { analyzePdf }
    const buffer = Buffer.from('%PDF-1.4 contenido')

    const texto = await gmailService.extractTextFromFile(buffer, 'CV.PDF', 'application/pdf')

    expect(analyzePdf).toHaveBeenCalledWith(buffer)
    expect(texto).toBe('Juan Perez\n\nSoldador calificado')
  })

  it('reconoce el PDF por extension aunque el mime venga generico', async () => {
    const analyzePdf = jest.fn(async () => ({ pages: 1, text: [{ page: 1, text: 'hola' }] }))
    gmailService.pdfAnalyzer = { analyzePdf }

    const texto = await gmailService.extractTextFromFile(Buffer.from('%PDF-'), 'cv.pdf', 'application/octet-stream')

    expect(texto).toBe('hola')
  })

  // Sidecar caido, PDF corrupto (400) o bomba (422): el CV queda sin texto y
  // la sincronizacion sigue con el cuerpo del correo.
  it('devuelve vacio si el analizador falla, sin propagar el error', async () => {
    gmailService.pdfAnalyzer = { analyzePdf: jest.fn(async () => { throw new Error('ECONNREFUSED') }) }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const texto = await gmailService.extractTextFromFile(Buffer.from('%PDF-'), 'cv.pdf', 'application/pdf')

    expect(texto).toBe('')
    warn.mockRestore()
  })
})
