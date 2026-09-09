// backend/tests/integration/adjuntos-roles-bpm.test.js
// El ADC asignado y el JefeRRHH deben alcanzar los adjuntos del referido.
//
// adjuntos.routes.js enumera TRABAJADOR, RRHH, ADMIN y EXTERNO, y deja fuera a
// JefeRRHH y a ADC. El criterio unico de src/lib/acceso.js si los contempla:
// JefeRRHH es privilegiado y el ADC asignado es una de las cuatro relaciones
// legitimas. Gana la ruta, que corta antes, asi que:
//
//   el ADC que tiene que dictaminar sobre un candidato no puede descargar su CV
//
// Eso no es un permiso mal puesto, es el BPM roto: el aprobador no puede leer lo
// que tiene que aprobar. Y es el modo de falla de V8 otra vez —una lista blanca
// de roles se rompe en silencio cuando aparece o cambia un rol.
//
// Abrir la ruta NO abre el acceso: assertReferidoAccess sigue acotando al ADC a
// los referidos que tiene ASIGNADOS. Los casos de abajo lo fijan, para que la
// correccion no se lea como un permiso mas amplio de lo que es.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader } = require('../helpers/auth')

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')

async function seedRolesExtra(getModel) {
  const Rol = getModel('Rol')
  for (const nombre of ['EXTERNO', 'JefeRRHH']) {
    await Rol.findOrCreate({
      where: { nombre },
      defaults: { nombre, descripcion: `Rol ${nombre} para testing` },
    })
  }
}

describe('Acceso a adjuntos de los roles del BPM', () => {
  let getModel
  let escenario

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await seedRoles(getModel)
    await seedRolesExtra(getModel)
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  beforeEach(async () => {
    await db.__resetTestDb()
    await seedRoles(getModel)
    await seedRolesExtra(getModel)
    escenario = await montarEscenario()
  })

  /** Referido enviado a ADC, con su CV cargado y un ADC asignado. */
  async function montarEscenario() {
    const dueno = await createTestUser(getModel, {
      username: 'dueno', correo: 'dueno@ecora.cl', roles: ['TRABAJADOR'],
    })
    const adcAsignado = await createTestUser(getModel, {
      username: 'adc-asignado', correo: 'adc1@ecora.cl', roles: ['ADC'],
    })
    const adcAjeno = await createTestUser(getModel, {
      username: 'adc-ajeno', correo: 'adc2@ecora.cl', roles: ['ADC'],
    })
    const jefeRRHH = await createTestUser(getModel, {
      username: 'jefe', correo: 'jefe@ecora.cl', roles: ['JefeRRHH'],
    })

    const referido = await getModel('Referido').create({
      nombre: 'CANDIDATO EN DICTAMEN',
      estado: 'ENVIADO_ADC',
      creadoPorUserId: dueno.id,
      asignadoADCUserId: adcAsignado.id,
    })

    const cv = await getModel('Documento').create({
      nombre: 'cv-candidato.pdf',
      ruta: 'uploads/referidos/cv-candidato.pdf',
      mimetype: 'application/pdf',
      size: PDF.length,
      referidoId: referido.id,
    })

    return { dueno, adcAsignado, adcAjeno, jefeRRHH, referido, cv }
  }

  // ────────────────────────────────────────────────────────────────
  // ADC asignado — el que tiene que dictaminar
  // ────────────────────────────────────────────────────────────────

  describe('ADC asignado al referido', () => {
    it('puede listar los adjuntos', async () => {
      const { adcAsignado, referido } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(adcAsignado))

      expect(res.status).toBe(200)
      expect(res.body).toHaveLength(1)
    })

    it('puede descargar el CV que tiene que evaluar', async () => {
      const { adcAsignado, referido, cv } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos/${cv.id}/download`)
        .set(authHeader(adcAsignado))

      // El archivo no existe en disco en este montaje: lo que importa es que la
      // ruta NO lo rechace por rol. 404 es del controlador, 403 seria el bug.
      expect(res.status).not.toBe(403)
    })

    it('puede subir un adjunto al referido asignado', async () => {
      const { adcAsignado, referido } = escenario

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(adcAsignado))
        .attach('files', PDF, { filename: 'informe-adc.pdf', contentType: 'application/pdf' })

      expect(res.status).toBe(201)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // ADC NO asignado — abrir la ruta no puede abrir el acceso
  // ────────────────────────────────────────────────────────────────

  describe('ADC que NO tiene el referido asignado', () => {
    it('sigue recibiendo 403 al listar', async () => {
      const { adcAjeno, referido } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(adcAjeno))

      expect(res.status).toBe(403)
    })

    it('sigue recibiendo 403 al descargar', async () => {
      const { adcAjeno, referido, cv } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos/${cv.id}/download`)
        .set(authHeader(adcAjeno))

      expect(res.status).toBe(403)
    })

    it('sigue recibiendo 403 al subir', async () => {
      const { adcAjeno, referido } = escenario

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(adcAjeno))
        .attach('files', PDF, { filename: 'x.pdf', contentType: 'application/pdf' })

      expect(res.status).toBe(403)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // JefeRRHH — privilegiado segun lib/acceso, excluido por la ruta
  // ────────────────────────────────────────────────────────────────

  describe('JefeRRHH', () => {
    it('puede listar los adjuntos de cualquier referido', async () => {
      const { jefeRRHH, referido } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(jefeRRHH))

      expect(res.status).toBe(200)
    })

    it('puede descargar', async () => {
      const { jefeRRHH, referido, cv } = escenario

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos/${cv.id}/download`)
        .set(authHeader(jefeRRHH))

      expect(res.status).not.toBe(403)
    })

    it('puede subir', async () => {
      const { jefeRRHH, referido } = escenario

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(jefeRRHH))
        .attach('files', PDF, { filename: 'observaciones-jefe.pdf', contentType: 'application/pdf' })

      expect(res.status).toBe(201)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // Coherencia: ver el referido y ver sus adjuntos no pueden discrepar
  // ────────────────────────────────────────────────────────────────

  describe('coherencia entre el referido y sus adjuntos', () => {
    it.each([
      ['ADC asignado', 'adcAsignado'],
      ['JefeRRHH', 'jefeRRHH'],
      ['dueño', 'dueno'],
    ])('%s obtiene el mismo veredicto en el detalle y en los adjuntos', async (_nombre, clave) => {
      const usuario = escenario[clave]
      const { referido } = escenario

      const detalle = await request(app)
        .get(`/api/referidos/${referido.id}`)
        .set(authHeader(usuario))
      const adjuntos = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(usuario))

      expect(detalle.status).toBe(adjuntos.status)
    })
  })
  // ────────────────────────────────────────────────────────────────
  // DELETE — quien puede eliminar evidencia del expediente
  // ────────────────────────────────────────────────────────────────

  describe('DELETE de un adjunto', () => {
    it('el JefeRRHH puede borrar, igual que RRHH y ADMIN', async () => {
      const { jefeRRHH, referido, cv } = escenario

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${cv.id}`)
        .set(authHeader(jefeRRHH))

      expect(res.status).toBe(200)
    })

    // El evaluador aporta su informe pero no elimina la evidencia sobre la que
    // dictamina. Es integridad del expediente, no falta de permisos: por eso el
    // ADC asignado SI puede subir y listar, y aqui recibe 403.
    it('el ADC asignado NO puede borrar, aunque tenga acceso al referido', async () => {
      const { adcAsignado, referido, cv } = escenario

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${cv.id}`)
        .set(authHeader(adcAsignado))

      expect(res.status).toBe(403)
    })

    it('el adjunto sigue existiendo tras el intento del ADC', async () => {
      const { adcAsignado, referido, cv } = escenario

      await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${cv.id}`)
        .set(authHeader(adcAsignado))

      const sigue = await getModel('Documento').findByPk(cv.id)
      expect(sigue).not.toBeNull()
    })

    it('el dueño del referido puede borrar sus adjuntos', async () => {
      const { dueno, referido, cv } = escenario

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${cv.id}`)
        .set(authHeader(dueno))

      expect(res.status).toBe(200)
    })

    it('un ADC sin el referido asignado tampoco puede borrar', async () => {
      const { adcAjeno, referido, cv } = escenario

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${cv.id}`)
        .set(authHeader(adcAjeno))

      expect(res.status).toBe(403)
    })
  })
  // ────────────────────────────────────────────────────────────────
  // Postulante externo: puede quitar solo antes de que le tomen la postulacion
  // ────────────────────────────────────────────────────────────────

  describe('postulante externo y el estado de su postulacion', () => {
    // El sufijo evita colisiones de username/correo cuando un caso monta dos
    // postulaciones en el mismo estado.
    let seq = 0

    /** Postulacion externa en el estado indicado, con un documento cargado. */
    async function montarPostulacion(estado) {
      const id = `${estado}-${++seq}`
      const rrhh = await createTestUser(getModel, {
        username: `rrhh-${id}`, correo: `rrhh-${id}@ecora.cl`, roles: ['RRHH'],
      })
      const postulante = await createTestUser(getModel, {
        username: `post-${id}`, correo: `post-${id}@otrodominio.com`, roles: ['EXTERNO'],
      })
      const referido = await getModel('Referido').create({
        nombre: 'POSTULANTE EXTERNO',
        estado,
        creadoPorUserId: rrhh.id,
        postulanteUserId: postulante.id,
      })
      const doc = await getModel('Documento').create({
        nombre: 'cv.pdf',
        ruta: 'uploads/postulaciones/cv.pdf',
        mimetype: 'application/pdf',
        size: PDF.length,
        referidoId: referido.id,
      })
      return { postulante, referido, doc }
    }

    it('puede borrar su documento mientras la postulacion esta en PENDIENTE', async () => {
      const { postulante, referido, doc } = await montarPostulacion('PENDIENTE')

      const res = await request(app)
        .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
        .set(authHeader(postulante))

      expect(res.status).toBe(200)
    })

    // Una vez que alguien tomo la postulacion, el expediente deja de ser suyo
    // para modificar: puede aportar, no quitar.
    it.each(['EN_REVISION', 'APROBADO_JEFE', 'ENVIADO_ADC', 'RECHAZADO'])(
      'NO puede borrar cuando la postulacion esta en %s',
      async (estado) => {
        const { postulante, referido, doc } = await montarPostulacion(estado)

        const res = await request(app)
          .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
          .set(authHeader(postulante))

        expect(res.status).toBe(403)

        const sigue = await getModel('Documento').findByPk(doc.id)
        expect(sigue).not.toBeNull()
      }
    )

    it('SI puede seguir agregando documentos con la postulacion en revision', async () => {
      const { postulante, referido } = await montarPostulacion('EN_REVISION')

      const res = await request(app)
        .post(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(postulante))
        .attach('files', PDF, { filename: 'certificado.pdf', contentType: 'application/pdf' })

      expect(res.status).toBe(201)
    })

    it('sigue pudiendo ver sus documentos en cualquier estado', async () => {
      const { postulante, referido } = await montarPostulacion('ENVIADO_ADC')

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(postulante))

      expect(res.status).toBe(200)
    })

    it('no puede borrar documentos de la postulacion de otro, ni en PENDIENTE', async () => {
      const propia = await montarPostulacion('PENDIENTE')
      const ajena = await montarPostulacion('PENDIENTE')

      const res = await request(app)
        .delete(`/api/referidos/${ajena.referido.id}/adjuntos/${ajena.doc.id}`)
        .set(authHeader(propia.postulante))

      expect(res.status).toBe(403)
    })
  })
})
