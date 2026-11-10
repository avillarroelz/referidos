// backend/tests/integration/pdf-analyzer.test.js
// Cliente Node contra el sidecar Rust real (services/pdf-analyzer). Levanta el
// binario compilado; si no existe (maquina sin Rust) la suite se omite con aviso.
//   cd services/pdf-analyzer && cargo build --release
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const SERVICE_DIR = path.join(__dirname, '../../../services/pdf-analyzer')
const BINARY = path.join(SERVICE_DIR, 'target/release', process.platform === 'win32' ? 'pdf-analyzer.exe' : 'pdf-analyzer')
const PORT = 4972
const fixture = (name) => fs.readFileSync(path.join(SERVICE_DIR, 'fixtures', name))

const disponible = fs.existsSync(BINARY)
if (!disponible) console.warn(`[pdf-analyzer] binario no compilado (${BINARY}): se omite la suite`)

;(disponible ? describe : describe.skip)('pdfAnalyzerClient contra el sidecar Rust', () => {
  let proceso
  let cliente
  const urlOriginal = process.env.PDF_ANALYZER_URL

  beforeAll(async () => {
    process.env.PDF_ANALYZER_URL = `http://127.0.0.1:${PORT}`
    cliente = require('../../src/services/pdfAnalyzerClient')
    proceso = spawn(BINARY, [], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' })
    for (let i = 0; i < 50 && !(await cliente.isPdfAnalyzerUp()); i++) {
      await new Promise(r => setTimeout(r, 100))
    }
  })

  afterAll(() => {
    proceso?.kill()
    if (urlOriginal === undefined) delete process.env.PDF_ANALYZER_URL
    else process.env.PDF_ANALYZER_URL = urlOriginal
  })

  it('un PDF valido devuelve paginas y coincidencias', async () => {
    const r = await cliente.analyzePdf(fixture('text.pdf'), { q: 'spanner' })

    expect(r.pages).toBe(2)
    expect(r.text.map(t => t.page)).toEqual([1, 2])
    expect(r.text[0].text).toContain('Hola mundo')
    expect(r.matches).toHaveLength(1)
    expect(r.matches[0].page).toBe(2)
  })

  it('un PDF corrupto lanza PdfAnalyzerError con status 400', async () => {
    await expect(cliente.analyzePdf(fixture('corrupt.pdf'))).rejects.toMatchObject({
      name: 'PdfAnalyzerError', status: 400,
    })
  })

  it('una bomba de compresion lanza PdfAnalyzerError con status 422', async () => {
    await expect(cliente.analyzePdf(fixture('bomb.pdf'))).rejects.toMatchObject({
      name: 'PdfAnalyzerError', status: 422,
    })
  })

  it('trae las imagenes salvo que se pidan sin ellas', async () => {
    expect((await cliente.analyzePdf(fixture('image.pdf'))).images).toHaveLength(1)
    expect((await cliente.analyzePdf(fixture('image.pdf'), { images: false })).images).toEqual([])
  })

  it('algo que no es PDF lanza PdfAnalyzerError con status 415', async () => {
    await expect(cliente.analyzePdf(Buffer.from('no soy un pdf'))).rejects.toMatchObject({ status: 415 })
  })
})
