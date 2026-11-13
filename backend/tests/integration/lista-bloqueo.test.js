// backend/tests/integration/lista-bloqueo.test.js
// Consulta a black (lista de no recontratación) en los cinco puntos de ingreso
// de personas, y visibilidad de la marca `enListaBloqueo` por rol.
// fetch se simula: nunca se llama a la API real de black.

jest.mock('../../src/services/gmailTokenStore', () => ({
  readConfig: jest.fn(async () => ({})),
  saveConfig: jest.fn(async () => {}),
  getSyncRefreshToken: jest.fn(async () => 'un-refresh-token'),
  storage: 'file',
}))

jest.mock('../../src/services/gmailService', () => ({
  initialize: jest.fn(async () => {}),
  searchEmails: jest.fn(async () => []),
  processOneEmail: jest.fn(),
  getEmail: jest.fn(async () => ({ payload: {} })),
  getAllAttachmentParts: jest.fn(() => []),
  downloadAttachment: jest.fn(),
  markAsRead: jest.fn(async () => {}),
  addLabel: jest.fn(async () => {}),
}))

const { createHmac } = require('node:crypto')
const request = require('supertest')
const { app } = require('../../src/app')
const { config } = require('../../src/config')
const db = require('../../src/db')
const gmailService = require('../../src/services/gmailService')
const { TEXTO_RECHAZO } = require('../../src/services/listaBloqueo')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

const URL_BLACK = 'https://black.test/api/lista'
const HUELLA_KEY = 'clave-de-huella-de-prueba'
const RUT_BLOQUEADO = '12345678-5'
const RUT_BLOQUEADO_PUNTOS = '12.345.678-5'
const RUT_LIBRE = '11111111-1'
const huellaDe = (rut) => createHmac('sha256', HUELLA_KEY).update(rut).digest('hex')

// Estado de la simulación de black
let black
function simularBlack() {
  black = { bloqueados: new Set([RUT_BLOQUEADO]), caido: false, consultas: [] }
  global.fetch = jest.fn(async (url) => {
    black.consultas.push(url)
    if (black.caido) throw new TypeError('fetch failed')
    const rut = decodeURIComponent(String(url).slice(URL_BLACK.length + 1))
    return {
      status: 200,
      ok: true,
      json: async () => ({ bloqueado: black.bloqueados.has(rut), nombre: 'NO DEBE LEERSE', motivo: 'NO DEBE LEERSE' }),
    }
  })
}

describe('Lista de no recontratación (black)', () => {
  let getModel
  let Referido
  let Historial
  let rrhh
  let trabajador
  let salida

  beforeAll(async () => {
    const instancia = await db.__initTestDb()
    getModel = instancia.getModel
    Referido = getModel('Referido')
    Historial = getModel('EstadoHistorial')
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    await db.__resetTestDb()
    await seedRoles(getModel)
    rrhh = await createTestUser(getModel, { username: 'rrhh-lb', correo: 'rrhh-lb@ecora.cl', roles: ['RRHH'] })
    trabajador = await createTestUser(getModel, { username: 'trab-lb', correo: 'trab-lb@ecora.cl', roles: ['TRABAJADOR'] })
    config.listaBloqueo = { url: URL_BLACK, apiKey: 'clave-api-de-prueba', huellaKey: HUELLA_KEY }
    simularBlack()
    salida = []
    for (const m of ['log', 'warn', 'error', 'info']) {
      jest.spyOn(console, m).mockImplementation((...a) => {
        salida.push(a.map(x => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
      })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
    delete config.listaBloqueo
    delete global.fetch
  })

  const crearInterno = (usuario, cuerpo) => request(app)
    .post('/api/referidos')
    .set(authHeader(usuario))
    .send({ nombre: 'Persona Prueba', ...cuerpo })

  // ────────────────────────────────────────────────────────────
  describe('POST /api/referidos (ingreso interno)', () => {
    // El rechazo imita la falla genérica de creación: quien ingresa no puede
    // distinguir un RUT bloqueado de un error del sistema (Ley 21.719, minimización)
    it('RUT bloqueado: 500 idéntico a la falla genérica y no crea nada', async () => {
      const res = await crearInterno(trabajador, { rut: RUT_BLOQUEADO_PUNTOS })

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'No se pudo crear el referido' })
      expect(await Referido.count()).toBe(0)
      expect(await Historial.count()).toBe(0)
    })

    it('RUT no bloqueado: crea (201)', async () => {
      const res = await crearInterno(trabajador, { rut: RUT_LIBRE })

      expect(res.status).toBe(201)
      expect(await Referido.count()).toBe(1)
      expect(black.consultas).toHaveLength(1)
    })

    it('sin RUT: crea y no consulta a black', async () => {
      const res = await crearInterno(trabajador, {})

      expect(res.status).toBe(201)
      expect(black.consultas).toHaveLength(0)
    })

    it('black caído y huella en el respaldo: 500 genérico', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })

      const res = await crearInterno(trabajador, { rut: RUT_BLOQUEADO })

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ error: 'No se pudo crear el referido' })
      expect(await Referido.count()).toBe(0)
    })

    it('black caído y huella ausente: crea', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_LIBRE) })

      const res = await crearInterno(trabajador, { rut: RUT_BLOQUEADO })

      expect(res.status).toBe(201)
    })

    it('black caído y sin respaldo (sin clave de huella): crea', async () => {
      black.caido = true
      config.listaBloqueo.huellaKey = ''

      const res = await crearInterno(trabajador, { rut: RUT_BLOQUEADO })

      expect(res.status).toBe(201)
    })

    it('integración apagada (sin configuración): crea sin consultar', async () => {
      config.listaBloqueo = { url: '', apiKey: '', huellaKey: '' }

      const res = await crearInterno(trabajador, { rut: RUT_BLOQUEADO })

      expect(res.status).toBe(201)
      expect(black.consultas).toHaveLength(0)
    })

    it('ningún console.* durante el rechazo contiene el RUT', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })

      await crearInterno(trabajador, { rut: RUT_BLOQUEADO_PUNTOS })

      const todo = salida.join('\n')
      expect(todo).not.toContain('12345678')
      expect(todo).not.toContain('12.345.678')
      expect(todo).not.toContain(huellaDe(RUT_BLOQUEADO))
    })
  })

  // ────────────────────────────────────────────────────────────
  describe('POST /api/referidos/sync/gmail/manual (importación con revisión)', () => {
    const importar = (items) => request(app)
      .post('/api/referidos/sync/gmail/manual')
      .set(authHeader(rrhh))
      .send({ referidos: items })

    it('un ítem bloqueado da error por ítem con el texto fijo; no crea ficha ni anota el correo; los demás se crean', async () => {
      const res = await importar([
        { messageId: 'msg-bloq', nombre: 'Persona Bloqueada', rut: RUT_BLOQUEADO_PUNTOS },
        { messageId: 'msg-libre', nombre: 'Persona Libre', rut: RUT_LIBRE },
      ])

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(1)
      expect(res.body.errors).toEqual([
        { messageId: 'msg-bloq', nombre: 'Persona Bloqueada', error: TEXTO_RECHAZO },
      ])
      expect(await Referido.count({ where: { gmailMessageId: 'msg-bloq' } })).toBe(0)
      expect(await getModel('GmailCorreoRevisado').count({ where: { gmailMessageId: 'msg-bloq' } })).toBe(0)
      expect(await Referido.count({ where: { gmailMessageId: 'msg-libre' } })).toBe(1)
      expect(gmailService.markAsRead).not.toHaveBeenCalledWith('msg-bloq')
    })

    it('black caído con huella en el respaldo: también se rechaza', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })

      const res = await importar([{ messageId: 'msg-resp', nombre: 'Persona Bloqueada', rut: RUT_BLOQUEADO }])

      expect(res.body.created).toBe(0)
      expect(res.body.errors[0].error).toBe(TEXTO_RECHAZO)
    })

    it('black caído y sin respaldo: se crea', async () => {
      black.caido = true
      config.listaBloqueo.huellaKey = ''

      const res = await importar([{ messageId: 'msg-sinresp', nombre: 'Persona', rut: RUT_BLOQUEADO }])

      expect(res.body.created).toBe(1)
    })

    it('lote con black caído: fetch se llama una sola vez y los tres se resuelven por respaldo', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })

      const res = await importar([
        { messageId: 'lote-1', nombre: 'Libre Uno', rut: RUT_LIBRE },
        { messageId: 'lote-2', nombre: 'Bloqueada', rut: RUT_BLOQUEADO_PUNTOS },
        { messageId: 'lote-3', nombre: 'Libre Tres', rut: '22222222-2' },
      ])

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(res.body.created).toBe(2)
      expect(res.body.errors).toEqual([{ messageId: 'lote-2', nombre: 'Bloqueada', error: TEXTO_RECHAZO }])
    })

    it('ítem sin RUT: se crea y no se consulta a black', async () => {
      const res = await importar([{ messageId: 'msg-sinrut', nombre: 'Persona Sin Rut' }])

      expect(res.body.created).toBe(1)
      expect(black.consultas).toHaveLength(0)
    })

    it('ningún console.* contiene el RUT del rechazado', async () => {
      await importar([{ messageId: 'msg-log', nombre: 'Persona Bloqueada', rut: RUT_BLOQUEADO_PUNTOS }])

      const todo = salida.join('\n')
      expect(todo).not.toContain('12345678')
      expect(todo).not.toContain('12.345.678')
    })
  })

  // ────────────────────────────────────────────────────────────
  describe('POST /api/referidos/sync/gmail (automático)', () => {
    const correo = (nombre, rut) => ({
      extractedData: { nombre, rut, email: null },
      from: 'x@y.cl',
      subject: 'referido',
    })

    it('un correo bloqueado no se crea y cuenta como error; el otro sí', async () => {
      gmailService.searchEmails.mockResolvedValue([{ id: 'a-bloq' }, { id: 'a-libre' }])
      gmailService.processOneEmail.mockImplementation(async (id) =>
        id === 'a-bloq' ? correo('Persona Bloqueada', RUT_BLOQUEADO) : correo('Persona Libre', RUT_LIBRE))

      const res = await request(app).post('/api/referidos/sync/gmail').set(authHeader(rrhh)).send({})

      expect(res.status).toBe(200)
      expect(res.body.created).toBe(1)
      expect(res.body.errors).toEqual([{ messageId: 'a-bloq', error: TEXTO_RECHAZO }])
      expect(await Referido.count({ where: { gmailMessageId: 'a-bloq' } })).toBe(0)
      expect(await getModel('GmailCorreoRevisado').count({ where: { gmailMessageId: 'a-bloq' } })).toBe(0)
      expect(await Referido.count({ where: { gmailMessageId: 'a-libre' } })).toBe(1)
      expect(gmailService.markAsRead).toHaveBeenCalledTimes(1)
      expect(gmailService.markAsRead).not.toHaveBeenCalledWith('a-bloq')
    })

    it('lote con black caído: fetch se llama una sola vez y los tres se resuelven por respaldo', async () => {
      black.caido = true
      await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })
      const ruts = { 'l-1': RUT_LIBRE, 'l-2': RUT_BLOQUEADO, 'l-3': '22222222-2' }
      gmailService.searchEmails.mockResolvedValue(Object.keys(ruts).map(id => ({ id })))
      gmailService.processOneEmail.mockImplementation(async (id) => correo(`Persona ${id}`, ruts[id]))

      const res = await request(app).post('/api/referidos/sync/gmail').set(authHeader(rrhh)).send({})

      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(res.body.created).toBe(2)
      expect(res.body.errors).toEqual([{ messageId: 'l-2', error: TEXTO_RECHAZO }])
    })

    it('ningún console.* contiene el RUT del rechazado', async () => {
      gmailService.searchEmails.mockResolvedValue([{ id: 'a-log' }])
      gmailService.processOneEmail.mockResolvedValue(correo('Persona Bloqueada', RUT_BLOQUEADO))

      await request(app).post('/api/referidos/sync/gmail').set(authHeader(rrhh)).send({})

      expect(salida.join('\n')).not.toContain('12345678')
    })
  })


  // ────────────────────────────────────────────────────────────
  // Postulantes y formulario público: se aceptan y se marcan, sin avisarles.
  describe('Postulaciones y formulario público (aceptar y marcar)', () => {
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
    const CAMPOS = {
      nombre: 'Ana',
      apellidoPaterno: 'Soto',
      fechaNacimiento: '1990-05-05',
      telefono: '+56911111111',
      cargoPostulado: 'Analista',
    }
    let externo
    const conMarca = () => Referido.scope('conMarca')

    beforeEach(async () => {
      await createTestUser(getModel, { username: 'admin-lb', correo: 'admin-lb@ecora.cl', roles: ['ADMIN'] })
      externo = await createTestUser(getModel, { username: 'ext-lb', correo: 'ext-lb@gmail.com', roles: ['EXTERNO'] })
    })

    const adjuntar = (req) => req
      .attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' })
      .attach('certificados', PDF, { filename: 'cert.pdf', contentType: 'application/pdf' })

    const postularAnonimo = (rut) => adjuntar(request(app).post('/api/public/postulaciones').field({ ...CAMPOS, rut }))
    const postularConSesion = (rut) => adjuntar(
      request(app).post('/api/postulaciones').set(authHeader(externo)).field({ ...CAMPOS, rut })
    )
    const referirPublico = (rut) => request(app).post('/api/public/referidos').send({ nombre: 'Persona Referida', rut })

    const sinId = (body) => ({ ...body, id: 0 })

    describe.each([
      ['POST /api/public/postulaciones (anónimo)', postularAnonimo],
      ['POST /api/postulaciones (con sesión)', postularConSesion],
      ['POST /api/public/referidos (formulario público)', referirPublico],
    ])('%s', (_nombre, enviar) => {
      it('bloqueado: crea PENDIENTE con la marca y la respuesta es idéntica a la de una persona libre', async () => {
        const libre = await enviar(RUT_LIBRE)
        const bloqueado = await enviar(RUT_BLOQUEADO_PUNTOS)

        expect(libre.status).toBe(201)
        expect(bloqueado.status).toBe(libre.status)
        expect(sinId(bloqueado.body)).toEqual(sinId(libre.body))
        expect(Object.keys(bloqueado.body).sort()).toEqual(Object.keys(libre.body).sort())
        expect(JSON.stringify(bloqueado.body)).not.toMatch(/bloque|lista|recontrata/i)

        const fichaBloqueada = await conMarca().findByPk(bloqueado.body.id)
        const fichaLibre = await conMarca().findByPk(libre.body.id)
        expect(fichaBloqueada.estado).toBe('PENDIENTE')
        expect(fichaBloqueada.enListaBloqueo).toBe(true)
        expect(fichaLibre.enListaBloqueo).toBe(false)
      })

      it('bloqueado: el historial de estados no dice nada del bloqueo', async () => {
        const libre = await enviar(RUT_LIBRE)
        const bloqueado = await enviar(RUT_BLOQUEADO)

        const hLibre = await Historial.findAll({ where: { referidoId: libre.body.id }, raw: true })
        const hBloqueado = await Historial.findAll({ where: { referidoId: bloqueado.body.id }, raw: true })
        expect(hBloqueado).toHaveLength(hLibre.length)
        expect(hBloqueado.map(h => [h.desde, h.hacia, h.comentario]))
          .toEqual(hLibre.map(h => [h.desde, h.hacia, h.comentario]))
        expect(JSON.stringify(hBloqueado)).not.toMatch(/bloque|lista|recontrata/i)
      })

      it('black caído con huella en el respaldo: queda marcada', async () => {
        black.caido = true
        await getModel('ListaBloqueoHuella').create({ huella: huellaDe(RUT_BLOQUEADO) })

        const res = await enviar(RUT_BLOQUEADO)

        expect(res.status).toBe(201)
        expect((await conMarca().findByPk(res.body.id)).enListaBloqueo).toBe(true)
      })

      it('black caído y sin respaldo: crea sin marca', async () => {
        black.caido = true
        config.listaBloqueo.huellaKey = ''

        const res = await enviar(RUT_BLOQUEADO)

        expect(res.status).toBe(201)
        expect((await conMarca().findByPk(res.body.id)).enListaBloqueo).toBe(false)
      })

      it('ningún console.* contiene el RUT', async () => {
        await enviar(RUT_BLOQUEADO_PUNTOS)

        const todo = salida.join('\n')
        expect(todo).not.toContain('12345678')
        expect(todo).not.toContain('12.345.678')
      })
    })

    it('el RUT se consulta una sola vez por postulación', async () => {
      await postularAnonimo(RUT_BLOQUEADO)
      expect(black.consultas).toHaveLength(1)
    })

    it('el postulante con sesión no ve la clave en "mis postulaciones", ni siquiera en false', async () => {
      await postularConSesion(RUT_BLOQUEADO)

      const res = await request(app).get('/api/postulaciones/mias').set(authHeader(externo))

      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(JSON.stringify(res.body)).not.toContain('enListaBloqueo')
    })
  })


  // ────────────────────────────────────────────────────────────
  // Control de acceso: la marca solo sale hacia RRHH, JefeRRHH y ADMIN.
  describe('Visibilidad de enListaBloqueo por rol', () => {
    const CLAVE = 'enListaBloqueo'
    let jefe
    let admin
    let adc
    let externo
    let marcada
    let libre

    beforeEach(async () => {
      jefe = await createTestUser(getModel, { username: 'jefe-lb', correo: 'jefe-lb@ecora.cl', roles: ['JefeRRHH'] })
      admin = await createTestUser(getModel, { username: 'admin-vis', correo: 'admin-vis@ecora.cl', roles: ['ADMIN'] })
      adc = await createTestUser(getModel, { username: 'adc-lb', correo: 'adc-lb@ecora.cl', roles: ['ADC'] })
      externo = await createTestUser(getModel, { username: 'ext-vis', correo: 'ext-vis@gmail.com', roles: ['EXTERNO'] })

      // Una ficha ligada a todos los actores: creada por el trabajador, postulada
      // por el externo y asignada al ADC.
      marcada = await Referido.create({
        nombre: 'MARCADA', rut: RUT_BLOQUEADO, estado: 'ENVIADO_ADC', enListaBloqueo: true,
        creadoPorUserId: trabajador.id, postulanteUserId: externo.id, asignadoADCUserId: adc.id,
      })
      libre = await Referido.create({
        nombre: 'LIBRE', rut: RUT_LIBRE, estado: 'ENVIADO_ADC', enListaBloqueo: false,
        creadoPorUserId: trabajador.id, postulanteUserId: externo.id, asignadoADCUserId: adc.id,
      })
    })

    const tieneClave = (res) => /enListaBloqueo|en_lista_bloqueo/.test(JSON.stringify(res.body))
    const get = (url, usuario) => {
      const r = request(app).get(url)
      return usuario ? r.set(authHeader(usuario)) : r
    }

    describe.each([['RRHH'], ['JefeRRHH'], ['ADMIN']])('rol %s', (rol) => {
      const usuario = () => ({ RRHH: rrhh, JefeRRHH: jefe, ADMIN: admin })[rol]

      it('el listado trae la marca como booleano', async () => {
        const res = await get('/api/referidos', usuario())

        expect(res.status).toBe(200)
        const porId = Object.fromEntries(res.body.data.map(r => [r.id, r]))
        expect(porId[marcada.id][CLAVE]).toBe(true)
        expect(porId[libre.id][CLAVE]).toBe(false)
      })

      it('el detalle trae la marca como booleano', async () => {
        const a = await get(`/api/referidos/${marcada.id}`, usuario())
        const b = await get(`/api/referidos/${libre.id}`, usuario())

        expect(a.status).toBe(200)
        expect(a.body[CLAVE]).toBe(true)
        expect(b.body[CLAVE]).toBe(false)
      })

      it('el historial no la trae', async () => {
        const res = await get(`/api/referidos/${marcada.id}/historial`, usuario())
        expect(res.status).toBe(200)
        expect(tieneClave(res)).toBe(false)
      })
    })

    describe('roles sin permiso: la clave no aparece, ni siquiera en false', () => {
      it('TRABAJADOR (creador): listado propio y detalle', async () => {
        const lista = await get('/api/referidos?mine=1', trabajador)
        const detalle = await get(`/api/referidos/${marcada.id}`, trabajador)

        expect(lista.status).toBe(200)
        expect(lista.body.data).toHaveLength(2)
        expect(tieneClave(lista)).toBe(false)
        expect(detalle.status).toBe(200)
        expect(tieneClave(detalle)).toBe(false)
      })

      it('ADC asignado: sus asignados y el detalle', async () => {
        const lista = await get('/api/referidos/mis-asignados', adc)
        const detalle = await get(`/api/referidos/${marcada.id}`, adc)

        expect(lista.status).toBe(200)
        expect(lista.body.data).toHaveLength(2)
        expect(tieneClave(lista)).toBe(false)
        expect(detalle.status).toBe(200)
        expect(tieneClave(detalle)).toBe(false)
      })

      it('EXTERNO (postulante): detalle, historial y mis postulaciones', async () => {
        const detalle = await get(`/api/referidos/${marcada.id}`, externo)
        const historial = await get(`/api/referidos/${marcada.id}/historial`, externo)
        const mias = await get('/api/postulaciones/mias', externo)

        expect(detalle.status).toBe(200)
        expect(tieneClave(detalle)).toBe(false)
        expect(historial.status).toBe(200)
        expect(tieneClave(historial)).toBe(false)
        expect(mias.status).toBe(200)
        expect(mias.body.data).toHaveLength(2)
        expect(tieneClave(mias)).toBe(false)
      })

      it('anónimo: no recibe la ficha', async () => {
        const res = await get(`/api/referidos/${marcada.id}`)

        expect(res.status).toBe(401)
        expect(tieneClave(res)).toBe(false)
      })

      it('la respuesta de creación interna no la trae (TRABAJADOR ni RRHH)', async () => {
        const a = await crearInterno(trabajador, { rut: RUT_LIBRE })
        const b = await crearInterno(rrhh, { rut: RUT_LIBRE })

        expect(a.status).toBe(201)
        expect(tieneClave(a)).toBe(false)
        expect(b.status).toBe(201)
        expect(tieneClave(b)).toBe(false)
      })

      it('las respuestas de importación desde Gmail no la traen', async () => {
        gmailService.searchEmails.mockResolvedValue([{ id: 'vis-auto' }])
        gmailService.processOneEmail.mockResolvedValue({
          extractedData: { nombre: 'Persona Auto', rut: null }, from: 'x@y.cl', subject: 'referido',
        })

        const auto = await request(app).post('/api/referidos/sync/gmail').set(authHeader(rrhh)).send({})
        const manual = await request(app).post('/api/referidos/sync/gmail/manual').set(authHeader(rrhh))
          .send({ referidos: [{ messageId: 'vis-manual', nombre: 'Persona Manual', rut: '22222222-2' }] })

        expect(auto.status).toBe(200)
        expect(auto.body.created).toBe(1)
        expect(tieneClave(auto)).toBe(false)
        expect(manual.status).toBe(200)
        expect(manual.body.created).toBe(1)
        expect(tieneClave(manual)).toBe(false)
      })

      it('el endpoint de integración por API key no la trae', async () => {
        const original = process.env.INTEGRACION_API_KEY
        process.env.INTEGRACION_API_KEY = 'llave-de-integracion-para-pruebas-0123456789'
        try {
          await marcada.update({ estado: 'APROBADO' })
          const res = await request(app)
            .patch(`/api/integracion/${marcada.id}/resultado-reclutamiento`)
            .set({ 'x-api-key': 'llave-de-integracion-para-pruebas-0123456789' })
            .send({ resultado: 'CONTRATADO' })

          expect(res.status).toBe(200)
          expect(tieneClave(res)).toBe(false)
        } finally {
          if (original === undefined) delete process.env.INTEGRACION_API_KEY
          else process.env.INTEGRACION_API_KEY = original
        }
      })
    })
  })

})
