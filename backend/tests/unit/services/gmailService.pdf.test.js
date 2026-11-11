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

    // Solo se usa el texto: las imágenes (fotos del CV) no se piden.
    expect(analyzePdf).toHaveBeenCalledWith(buffer, { images: false })
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

  // Ley 21.719: el nombre del archivo de un CV casi siempre trae el nombre de la persona.
  it('los logs no llevan el nombre del archivo (lectura fallida ni lectura correcta)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    gmailService.pdfAnalyzer = { analyzePdf: jest.fn(async () => { throw new Error('ECONNREFUSED') }) }
    await gmailService.extractTextFromFile(Buffer.from('%PDF-'), 'Maria Gonzalez CV.pdf', 'application/pdf')

    const textoCv = 'Maria Gonzalez, soldadora calificada con experiencia en faenas mineras.'
    jest.spyOn(gmailService, 'getReadableAttachmentParts').mockReturnValue([
      { filename: 'Maria Gonzalez CV.pdf', mimeType: 'application/pdf', attachmentId: 'A1', size: 100 },
    ])
    jest.spyOn(gmailService, 'downloadAttachment').mockResolvedValue(Buffer.from('%PDF-'))
    jest.spyOn(gmailService, 'extractTextFromFile').mockResolvedValue(textoCv)
    await gmailService.extractAttachmentsText('m1', {})

    expect(log).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    const logs = JSON.stringify([...warn.mock.calls, ...log.mock.calls])
    expect(logs).not.toMatch(/Maria|Gonzalez/)
    jest.restoreAllMocks()
  })
})

// processOneEmail: lo que el preview entrega al front (adjuntos sin attachmentId
// y respuestas a las preguntas de filtro).
describe('gmailService.processOneEmail', () => {
  const emailParserAI = require('../../../src/services/emailParserAI')
  const TEXTO_CV = 'Juan Perez, soldador calificado con diez años de experiencia en faenas mineras. '.repeat(3)
  const correo = {
    payload: {
      headers: [
        { name: 'Subject', value: 'CV Juan' },
        { name: 'From', value: 'juan@x.cl' },
        { name: 'Date', value: 'hoy' },
      ],
      parts: [{ filename: 'cv.pdf', mimeType: 'application/pdf', body: { attachmentId: 'ATT-SECRETO', size: 1234 } }],
    },
  }

  beforeEach(() => {
    jest.spyOn(gmailService, 'getEmail').mockResolvedValue(correo)
    jest.spyOn(gmailService, 'downloadAttachment').mockResolvedValue(Buffer.from('%PDF-'))
    jest.spyOn(gmailService, 'extractTextFromFile').mockResolvedValue(TEXTO_CV)
    jest.spyOn(emailParserAI, 'isAvailable').mockReturnValue(true)
  })
  afterEach(() => jest.restoreAllMocks())

  it('no expone el attachmentId en attachmentParts', async () => {
    jest.spyOn(emailParserAI, 'parse').mockResolvedValue({ nombre: 'Juan', respuestas: [] })

    const r = await gmailService.processOneEmail('m1')

    expect(r.attachmentParts).toEqual([{ filename: 'cv.pdf', mimeType: 'application/pdf', size: 1234 }])
  })

  it('pasa las preguntas a la IA y separa las respuestas de los datos extraidos', async () => {
    const respuestas = [{ pregunta: 'Licencia B?', respuesta: 'si', cita: 'Licencia B' }]
    const parse = jest.spyOn(emailParserAI, 'parse').mockResolvedValue({ nombre: 'Juan', email: null, respuestas })

    const r = await gmailService.processOneEmail('m1', ['Licencia B?'])

    expect(parse).toHaveBeenCalledWith(expect.any(String), 'CV Juan', 'juan@x.cl', true, ['Licencia B?'])
    expect(r.respuestas).toEqual(respuestas)
    expect(r.extractedData).toEqual({ nombre: 'Juan', email: null })
    expect(r.extractedData).not.toHaveProperty('respuestas')
  })

  it('sin preguntas devuelve respuestas vacias', async () => {
    jest.spyOn(emailParserAI, 'parse').mockResolvedValue({ nombre: 'Juan' })

    const r = await gmailService.processOneEmail('m1')

    expect(r.respuestas).toEqual([])
  })

  it('si la IA falla cae al regex y respuestas queda vacio, sin propagar el error', async () => {
    jest.spyOn(emailParserAI, 'parse').mockRejectedValue(new Error('429'))
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await gmailService.processOneEmail('m1', ['Licencia B?'])

    expect(r.parseSource).toBe('regex')
    expect(r.respuestas).toEqual([])
  })
})
