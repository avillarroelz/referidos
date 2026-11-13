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
    // El correo que la IA no trajo (null) se completa con el remitente externo.
    expect(r.extractedData).toEqual({ nombre: 'Juan', email: 'juan@x.cl', rellenadoDesdeRemitente: ['email'] })
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

// Relleno de lo que falta con el remitente: externo = postulante, @ecora.cl =
// quien refiere, portales automaticos = nada. Lo que trae la IA/regex manda.
describe('gmailService.processOneEmail: relleno desde el remitente', () => {
  const emailParserAI = require('../../../src/services/emailParserAI')
  const TEXTO_CV = 'Juan Perez, soldador calificado con diez años de experiencia en faenas mineras. '.repeat(3)

  // Lo que Gmail escribe cuando el correo realmente salio de ecora.cl.
  const AUTH_ECORA = 'mx.google.com; dkim=pass header.i=@ecora.cl header.s=google header.b=abc; spf=pass smtp.mailfrom=maria@ecora.cl; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=ecora.cl'

  const conRemitente = (from, datosIA, authResults) => {
    const headers = [
      { name: 'Subject', value: 'CV' }, { name: 'From', value: from }, { name: 'Date', value: 'hoy' },
    ]
    if (authResults) headers.push({ name: 'Authentication-Results', value: authResults })
    jest.spyOn(gmailService, 'getEmail').mockResolvedValue({ payload: { headers } })
    jest.spyOn(gmailService, 'extractAttachmentsText').mockResolvedValue({ text: TEXTO_CV, filenames: [] })
    jest.spyOn(emailParserAI, 'isAvailable').mockReturnValue(true)
    jest.spyOn(emailParserAI, 'parse').mockResolvedValue(datosIA)
    return gmailService.processOneEmail('m1')
  }
  afterEach(() => jest.restoreAllMocks())

  it('remitente externo con nombre: rellena nombre y email que faltan', async () => {
    const r = await conRemitente('"Juan Pérez" <juan@gmail.com>', { nombre: null, email: null, telefono: '+56911112222' })

    expect(r.extractedData).toMatchObject({ nombre: 'Juan Pérez', email: 'juan@gmail.com', telefono: '+56911112222' })
  })

  it('remitente externo sin comillas ni nombre', async () => {
    const sinComillas = await conRemitente('Ana Soto <ana@gmail.com>', {})
    expect(sinComillas.extractedData).toMatchObject({ nombre: 'Ana Soto', email: 'ana@gmail.com' })

    const soloCorreo = await conRemitente('ana@gmail.com', {})
    expect(soloCorreo.extractedData.email).toBe('ana@gmail.com')
    expect(soloCorreo.extractedData.nombre).toBeFalsy()
  })

  it('nunca pisa un valor que trajo la IA', async () => {
    const r = await conRemitente('"Otro Nombre" <otro@gmail.com>', { nombre: 'Nombre del CV', email: 'cv@x.cl' })

    expect(r.extractedData).toMatchObject({ nombre: 'Nombre del CV', email: 'cv@x.cl' })
  })

  it('rellena solo el campo que falta', async () => {
    const r = await conRemitente('"Otro Nombre" <otro@gmail.com>', { nombre: 'Nombre del CV', email: null })

    expect(r.extractedData).toMatchObject({ nombre: 'Nombre del CV', email: 'otro@gmail.com' })
  })

  it('remitente @ecora.cl: su nombre va a nombreReferidor y no se toma como postulante', async () => {
    const r = await conRemitente('"María Referidora" <maria@ecora.cl>', { nombre: 'Postulante', email: null, nombreReferidor: null }, AUTH_ECORA)

    expect(r.extractedData.nombreReferidor).toBe('María Referidora')
    expect(r.extractedData.nombre).toBe('Postulante')
    expect(r.extractedData.email).toBeNull()
  })

  it('remitente @ecora.cl: no rellena nombre ni email aunque falten, ni pisa nombreReferidor', async () => {
    const vacio = await conRemitente('"María Referidora" <maria@ecora.cl>', {}, AUTH_ECORA)
    expect(vacio.extractedData.nombre).toBeFalsy()
    expect(vacio.extractedData.email).toBeFalsy()

    const conReferidor = await conRemitente('"María Referidora" <maria@ecora.cl>', { nombreReferidor: 'Pedro del CV' }, AUTH_ECORA)
    expect(conReferidor.extractedData.nombreReferidor).toBe('Pedro del CV')
  })

  it.each([
    'Laborum <no-reply@laborum.cl>',
    'noreply@computrabajo.com',
    'Notificaciones <notificaciones@empresa.cl>',
    'Mail Delivery <mailer-daemon@googlemail.com>',
    'postmaster@x.cl',
    'no-responder@x.cl',
    'noresponder@x.cl',
    'no_responder@x.cl',
    'no.responder@x.cl',
    'info@empresa.cl',
    'Contacto <contacto@empresa.cl>',
    'newsletter@empresa.cl',
  ])('remitente automatico (%s) no rellena nada', async (from) => {
    const r = await conRemitente(from, { nombre: null, email: null, nombreReferidor: null })

    expect(r.extractedData).toEqual({ nombre: null, email: null, nombreReferidor: null })
  })

  it('marca que campos salieron del remitente (rellenadoDesdeRemitente)', async () => {
    const ambos = await conRemitente('Ana Soto <ana@gmail.com>', {})
    expect(ambos.extractedData.rellenadoDesdeRemitente).toEqual(['nombre', 'email'])

    const soloEmail = await conRemitente('Ana Soto <ana@gmail.com>', { nombre: 'Del CV' })
    expect(soloEmail.extractedData.rellenadoDesdeRemitente).toEqual(['email'])

    const nada = await conRemitente('Ana Soto <ana@gmail.com>', { nombre: 'Del CV', email: 'cv@x.cl' })
    expect(nada.extractedData).not.toHaveProperty('rellenadoDesdeRemitente')

    const interno = await conRemitente('María <maria@ecora.cl>', {}, AUTH_ECORA)
    expect(interno.extractedData.rellenadoDesdeRemitente).toEqual(['nombreReferidor'])
  })

  // MIME (RFC 2047): Gmail entrega el display name tal como vino en el header.
  it.each([
    ['Q utf-8', '=?UTF-8?Q?Mar=C3=ADa_P=C3=A9rez?= <maria@gmail.com>', 'María Pérez'],
    ['B base64', '=?UTF-8?B?TWFyw61hIFDDqXJleg==?= <maria@gmail.com>', 'María Pérez'],
    ['Q iso-8859-1', '=?ISO-8859-1?Q?Mar=EDa_P=E9rez?= <maria@gmail.com>', 'María Pérez'],
    ['palabras codificadas contiguas', '=?UTF-8?Q?Mar=C3=ADa?= =?UTF-8?Q?_P=C3=A9rez?= <maria@gmail.com>', 'María Pérez'],
    ['mezcla con texto plano', 'Dra. =?UTF-8?Q?Mar=C3=ADa?= <maria@gmail.com>', 'Dra. María'],
  ])('decodifica el nombre del remitente (%s)', async (_n, from, esperado) => {
    const r = await conRemitente(from, {})

    expect(r.extractedData).toMatchObject({ nombre: esperado, email: 'maria@gmail.com' })
  })

  it('un nombre que no se puede decodificar queda sin nombre, pero conserva el correo', async () => {
    const r = await conRemitente('=?x-charset-raro?Q?abc?= <maria@gmail.com>', {})

    expect(r.extractedData.nombre).toBeFalsy()
    expect(r.extractedData.email).toBe('maria@gmail.com')
    expect(r.extractedData.rellenadoDesdeRemitente).toEqual(['email'])
  })

  it('un nombre que contiene @ se descarta (suplantacion de otro correo)', async () => {
    const r = await conRemitente('"jefe@ecora.cl" <x@gmail.com>', {})

    expect(r.extractedData.nombre).toBeFalsy()
    expect(r.extractedData.email).toBe('x@gmail.com')
  })

  describe('remitente @ecora.cl: solo si el correo realmente salio de ecora.cl', () => {
    const DE = '"María Referidora" <maria@ecora.cl>'

    it('dkim=pass con header.d del dominio interno', async () => {
      const r = await conRemitente(DE, {}, 'mx.google.com; dkim=pass header.d=ecora.cl header.s=s1; spf=pass')
      expect(r.extractedData.nombreReferidor).toBe('María Referidora')
    })

    it('dmarc=pass con header.from del dominio interno', async () => {
      const r = await conRemitente(DE, {}, 'mx.google.com; dmarc=pass (p=NONE) header.from=ecora.cl')
      expect(r.extractedData.nombreReferidor).toBe('María Referidora')
    })

    // El ARC lo puede fabricar el remitente: solo no habilita nada.
    it('un ARC-Authentication-Results solo (sin Authentication-Results) NO habilita el relleno interno', async () => {
      jest.spyOn(gmailService, 'extractAttachmentsText').mockResolvedValue({ text: TEXTO_CV, filenames: [] })
      jest.spyOn(emailParserAI, 'isAvailable').mockReturnValue(true)
      jest.spyOn(emailParserAI, 'parse').mockResolvedValue({})
      jest.spyOn(gmailService, 'getEmail').mockResolvedValue({ payload: { headers: [
        { name: 'From', value: DE }, { name: 'ARC-Authentication-Results', value: 'i=1; mx.google.com; dkim=pass header.d=ecora.cl' },
      ] } })

      const r = await gmailService.processOneEmail('m1')

      expect(r.extractedData.nombreReferidor).toBeFalsy()
    })

    // Gmail pone sus ARC antes; el que vale es el de authserv-id mx.google.com.
    it('un Authentication-Results de otro authserv-id (falsificado) se ignora aunque diga dmarc=pass', async () => {
      const r = await conRemitente(DE, {}, 'evil.example.com; dmarc=pass header.from=ecora.cl; dkim=pass header.d=ecora.cl')

      expect(r.extractedData.nombreReferidor).toBeFalsy()
    })

    it('con varios Authentication-Results usa el de mx.google.com, no el falsificado que viene antes', async () => {
      jest.spyOn(gmailService, 'extractAttachmentsText').mockResolvedValue({ text: TEXTO_CV, filenames: [] })
      jest.spyOn(emailParserAI, 'isAvailable').mockReturnValue(true)
      jest.spyOn(emailParserAI, 'parse').mockResolvedValue({})
      jest.spyOn(gmailService, 'getEmail').mockResolvedValue({ payload: { headers: [
        { name: 'From', value: DE },
        { name: 'Authentication-Results', value: 'evil.example.com; dmarc=pass header.from=ecora.cl' },
        { name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail header.from=ecora.cl' },
      ] } })

      const r = await gmailService.processOneEmail('m1')

      expect(r.extractedData.nombreReferidor).toBeFalsy()
    })

    it.each([
      ['dkim=fail', 'mx.google.com; dkim=fail header.d=ecora.cl; dmarc=fail header.from=ecora.cl'],
      ['pass de otro dominio', 'mx.google.com; dkim=pass header.d=evil.com; dmarc=pass header.from=evil.com'],
      ['pass de un dominio que termina igual', 'mx.google.com; dkim=pass header.d=noecora.cl'],
      ['sin resultado de autenticacion', undefined],
    ])('%s: no rellena nada, ni como interno ni como externo', async (_n, auth) => {
      const r = await conRemitente(DE, { nombre: null, email: null, nombreReferidor: null }, auth)

      expect(r.extractedData).toEqual({ nombre: null, email: null, nombreReferidor: null })
    })

    it('un correo @ecora.cl@otro.com no es interno: su dominio es el ultimo tras @', async () => {
      const r = await conRemitente('Boss <boss@ecora.cl@evil.com>', {}, AUTH_ECORA)

      expect(r.extractedData.nombreReferidor).toBeFalsy()
    })
  })

  describe('bordes del parseo de From', () => {
    it('mas de un <...> no se interpreta', async () => {
      const r = await conRemitente('A <a@gmail.com> <b@evil.com>', { nombre: null, email: null })
      expect(r.extractedData).toEqual({ nombre: null, email: null })
    })

    it('coma fuera de comillas (varios remitentes) no se interpreta', async () => {
      const r = await conRemitente('Pérez, Juan <j@gmail.com>', { nombre: null, email: null })
      expect(r.extractedData).toEqual({ nombre: null, email: null })
    })

    it('coma dentro de comillas es parte del nombre', async () => {
      const r = await conRemitente('"Pérez, Juan" <j@gmail.com>', {})
      expect(r.extractedData).toMatchObject({ nombre: 'Pérez, Juan', email: 'j@gmail.com' })
    })

    it('quita barras invertidas y caracteres de control del nombre', async () => {
      const r = await conRemitente('"Ana\\ \u0007Soto\u0000" <a@gmail.com>', {})
      expect(r.extractedData.nombre).toBe('Ana Soto')
    })

    it('corta el nombre a 100 caracteres', async () => {
      const r = await conRemitente(`${'A'.repeat(150)} <a@gmail.com>`, {})
      expect(r.extractedData.nombre).toHaveLength(100)
    })
  })

  it('sin correo valido en From no rellena nada', async () => {
    const r = await conRemitente('esto no es un remitente', { nombre: null, email: null })

    expect(r.extractedData).toEqual({ nombre: null, email: null })
  })

  it('tambien rellena cuando la IA cae al regex', async () => {
    jest.spyOn(emailParserAI, 'parse').mockRejectedValue(new Error('429'))
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const spy = jest.spyOn(emailParserAI, 'isAvailable').mockReturnValue(true)
    jest.spyOn(gmailService, 'getEmail').mockResolvedValue({
      payload: { headers: [{ name: 'From', value: 'Rosa Diaz <rosa@gmail.com>' }, { name: 'Subject', value: 'x' }] },
    })
    jest.spyOn(gmailService, 'extractAttachmentsText').mockResolvedValue({ text: TEXTO_CV, filenames: [] })

    const r = await gmailService.processOneEmail('m1')

    expect(spy).toHaveBeenCalled()
    expect(r.parseSource).toBe('regex')
    expect(r.extractedData).toMatchObject({ nombre: 'Rosa Diaz', email: 'rosa@gmail.com' })
  })
})
