// backend/tests/integration/postulaciones-upload.test.js
// Linea base del contrato de subida de POST /api/public/postulaciones, la unica
// ruta de la aplicacion que acepta archivos de un anonimo de internet.
//
// Estas pruebas NO demuestran un bug: fijan el comportamiento ACTUAL de multer
// antes de subir la dependencia (GHSA-72gw-mp4g-v24j, DoS por nombres de campo
// anidados, afecta 1.0.0 - 2.1.1). Si el bump cambia el contrato en algo, se
// enteran aca y no en produccion.
//
// El DoS del advisory no se reproduce a proposito: una prueba que dispare el
// agotamiento real es cara y fragil en CI, y el rango de versiones del advisory
// ya es evidencia suficiente para justificar la subida.

const fs = require('fs')
const path = require('path')
const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser } = require('../helpers/auth')

// PDF minimo valido: lo que importa aca es el mimetype declarado y la extension,
// que es exactamente lo unico que el fileFilter mira hoy.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')

const CAMPOS_BASE = {
  nombre: 'Ana',
  apellidoPaterno: 'Soto',
  fechaNacimiento: '1990-05-05',
  telefono: '+56911111111',
  cargoPostulado: 'Analista',
}

const DIR_SUBIDAS = path.join(process.cwd(), 'uploads', 'postulaciones')

/** Postula con el RUT indicado (unico por caso: el controller bloquea duplicados). */
function postular(rut) {
  return request(app)
    .post('/api/public/postulaciones')
    .field({ ...CAMPOS_BASE, rut })
}

describe('Contrato de subida de POST /api/public/postulaciones', () => {
  let getModel

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    // Sin sesion el creador formal es un ADMIN; sin el, el endpoint responde 500.
    await createTestUser(getModel, {
      username: 'admin-postulaciones', correo: 'admin@ecora.cl', roles: ['ADMIN'],
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Caso feliz
  // ────────────────────────────────────────────────────────────────

  it('acepta una postulacion anonima con CV en PDF (201)', async () => {
    const res = await postular('15111111-1')
      .attach('cv', PDF, { filename: 'curriculum.pdf', contentType: 'application/pdf' })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.id).toBeDefined()

    const docs = await getModel('Documento').findAll()
    expect(docs).toHaveLength(1)
    expect(docs[0].mimetype).toBe('application/pdf')
  })

  it('acepta el CV junto con documentos adicionales', async () => {
    const res = await postular('15222222-2')
      .attach('cv', PDF, { filename: 'curriculum.pdf', contentType: 'application/pdf' })
      .attach('documentos', PDF, { filename: 'certificado1.pdf', contentType: 'application/pdf' })
      .attach('documentos', PDF, { filename: 'certificado2.pdf', contentType: 'application/pdf' })

    expect(res.status).toBe(201)

    const docs = await getModel('Documento').findAll()
    expect(docs).toHaveLength(3)
  })

  // ────────────────────────────────────────────────────────────────
  // Nombre de archivo saneado
  // ────────────────────────────────────────────────────────────────

  it('sanea el nombre del archivo guardado en disco', async () => {
    const res = await postular('15333333-3')
      .attach('cv', PDF, {
        filename: 'mi cv (final) 2026!.pdf',
        contentType: 'application/pdf',
      })

    expect(res.status).toBe(201)

    const [doc] = await getModel('Documento').findAll()
    // La ruta en disco lleva timestamp y solo [A-Za-z0-9_.-]: espacios, parentesis
    // y signos se reemplazan por "_".
    expect(doc.ruta).toMatch(/^uploads\/postulaciones\/\d+-[\w.-]+$/)
    expect(doc.ruta).not.toContain(' ')
    expect(doc.ruta).not.toContain('(')
    // El nombre original se conserva como metadato para mostrarlo al usuario.
    expect(doc.nombre).toBe('mi cv (final) 2026!.pdf')
  })

  it('no permite escapar del directorio de subidas con el nombre del archivo', async () => {
    const res = await postular('15444444-4')
      .attach('cv', PDF, {
        filename: '../../../etc/passwd.pdf',
        contentType: 'application/pdf',
      })

    expect(res.status).toBe(201)

    const [doc] = await getModel('Documento').findAll()
    expect(doc.ruta.startsWith('uploads/postulaciones/')).toBe(true)
    expect(doc.ruta).not.toContain('..')
  })

  // ────────────────────────────────────────────────────────────────
  // Rechazos
  // ────────────────────────────────────────────────────────────────

  it('rechaza la postulacion sin CV (400)', async () => {
    const res = await postular('15555555-5')

    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('CV')
  })

  it('rechaza documentos adicionales que no sean PDF (400)', async () => {
    const res = await postular('15666666-6')
      .attach('cv', PDF, { filename: 'curriculum.pdf', contentType: 'application/pdf' })
      .attach('documentos', PDF, { filename: 'foto.png', contentType: 'image/png' })

    expect(res.status).toBe(400)

    const docs = await getModel('Documento').findAll()
    expect(docs).toHaveLength(0)
  })

  it('rechaza un tipo de archivo fuera de la whitelist del fileFilter', async () => {
    const res = await postular('15777777-7')
      .attach('cv', Buffer.from('texto plano'), {
        filename: 'notas.txt', contentType: 'text/plain',
      })

    // El rechazo es de la ENTRADA del cliente, no un fallo del servidor.
    expect(res.status).toBe(400)
    // El mensaje es propio: no se filtra interioridad de la libreria.
    expect(res.body.error).not.toContain('Multer')

    const referidos = await getModel('Referido').count()
    expect(referidos).toBe(0)
  })

  it('rechaza un archivo por sobre el limite de 10MB', async () => {
    const res = await postular('15888888-8')
      .attach('cv', Buffer.alloc(11 * 1024 * 1024, 0x41), {
        filename: 'enorme.pdf', contentType: 'application/pdf',
      })

    expect(res.status).toBe(413)
    expect(res.body.error).toContain('10MB')
    // "File too large" es el texto interno de multer: no debe salir al cliente.
    expect(res.body.error).not.toContain('File too large')

    const referidos = await getModel('Referido').count()
    expect(referidos).toBe(0)
  })

  // ────────────────────────────────────────────────────────────────
  // Reglas de negocio que dependen de la subida
  // ────────────────────────────────────────────────────────────────

  it('bloquea la doble postulacion al mismo cargo con el mismo RUT (409)', async () => {
    await postular('15999999-9')
      .attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' })

    const res = await postular('15.999.999-9') // mismo RUT con otro formato
      .attach('cv', PDF, { filename: 'cv.pdf', contentType: 'application/pdf' })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe('DUPLICATE_POSTULACION')
  })

  it('no deja archivos temporales cuando la postulacion es rechazada', async () => {
    const antes = fs.existsSync(DIR_SUBIDAS) ? fs.readdirSync(DIR_SUBIDAS).length : 0

    await postular('16111111-1')
      .attach('cv', PDF, { filename: 'curriculum.pdf', contentType: 'application/pdf' })
      .attach('documentos', PDF, { filename: 'foto.png', contentType: 'image/png' })

    const despues = fs.existsSync(DIR_SUBIDAS) ? fs.readdirSync(DIR_SUBIDAS).length : 0
    expect(despues).toBe(antes)
  })
})
