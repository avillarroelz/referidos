// backend/tests/integration/auditoria-borrado-adjuntos.test.js
// Traza de eliminacion de documentos de un candidato.
//
// Antes de esto no quedaba registro de ningun borrado: ni de RRHH, ni de ADMIN,
// ni del propio postulante. estado_historial solo guarda cambios de estado del
// BPM, asi que un expediente podia quedar vacio sin que nadie pudiera decir
// quien lo vacio, cuando ni con que titulo.
//
// Importa por Ley 21.719: sin traza no hay forma de responder quien elimino
// datos personales de un candidato, y tampoco de resolver el reclamo de alguien
// que fue rechazado y pregunta que se evaluo.
//
// La tabla guarda nombre_archivo y s3_key porque despues del borrado son la
// unica forma de saber QUE se elimino, y via_acceso porque la pregunta de
// cumplimiento no es solo quien borro sino con que titulo lo hizo.

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

describe('Auditoria de borrado de adjuntos', () => {
  let getModel
  let seq = 0

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
  })

  const auditoria = () => getModel('AuditoriaDocumento')

  /**
   * Expediente con un documento. `estado` decide si el postulante puede o no
   * eliminarlo, y `asignarAdc` si hay un ADC con el referido asignado.
   */
  async function montar({ estado = 'PENDIENTE' } = {}) {
    const id = ++seq
    const rrhh = await createTestUser(getModel, {
      username: `rrhh-${id}`, correo: `rrhh-${id}@ecora.cl`, roles: ['RRHH'],
    })
    const creador = await createTestUser(getModel, {
      username: `creador-${id}`, correo: `creador-${id}@ecora.cl`, roles: ['TRABAJADOR'],
    })
    const postulante = await createTestUser(getModel, {
      username: `post-${id}`, correo: `post-${id}@otrodominio.com`, roles: ['EXTERNO'],
    })
    const adc = await createTestUser(getModel, {
      username: `adc-${id}`, correo: `adc-${id}@ecora.cl`, roles: ['ADC'],
    })

    const referido = await getModel('Referido').create({
      nombre: 'CANDIDATO AUDITADO',
      estado,
      creadoPorUserId: creador.id,
      postulanteUserId: postulante.id,
      asignadoADCUserId: adc.id,
    })

    const doc = await getModel('Documento').create({
      nombre: 'cv-confidencial.pdf',
      ruta: 'uploads/referidos/cv-confidencial.pdf',
      s3Key: 'referidos/12345678/cv-confidencial.pdf',
      mimetype: 'application/pdf',
      size: PDF.length,
      referidoId: referido.id,
    })

    return { rrhh, creador, postulante, adc, referido, doc }
  }

  function borrar(referido, doc, usuario) {
    return request(app)
      .delete(`/api/referidos/${referido.id}/adjuntos/${doc.id}`)
      .set(authHeader(usuario))
  }

  // ────────────────────────────────────────────────────────────────
  // El borrado permitido deja registro
  // ────────────────────────────────────────────────────────────────

  describe('borrado permitido', () => {
    it('registra el borrado con quien, que, de donde y cuando', async () => {
      const { rrhh, referido, doc } = await montar()

      const res = await borrar(referido, doc, rrhh)
      expect(res.status).toBe(200)

      const filas = await auditoria().findAll()
      expect(filas).toHaveLength(1)

      const fila = filas[0].toJSON()
      expect(fila.documentoId).toBe(doc.id)
      expect(fila.referidoId).toBe(referido.id)
      expect(fila.actorUserId).toBe(rrhh.id)
      expect(fila.accion).toBe('ELIMINACION')
      expect(fila.createdAt || fila.created_at).toBeDefined()
    })

    // Tras el borrado, la fila de Documento ya no existe: el nombre y la llave
    // de S3 solo sobreviven aca.
    it('conserva el nombre del archivo y la llave de S3 del documento borrado', async () => {
      const { rrhh, referido, doc } = await montar()

      await borrar(referido, doc, rrhh)

      const [fila] = await auditoria().findAll()
      expect(fila.nombreArchivo).toBe('cv-confidencial.pdf')
      expect(fila.s3Key).toBe('referidos/12345678/cv-confidencial.pdf')

      // El documento efectivamente ya no esta, y la auditoria sobrevive.
      expect(await getModel('Documento').findByPk(doc.id)).toBeNull()
    })

    it('registra la IP del actor', async () => {
      const { rrhh, referido, doc } = await montar()

      await borrar(referido, doc, rrhh)

      const [fila] = await auditoria().findAll()
      expect(fila.ip).toBeTruthy()
    })
  })

  // ────────────────────────────────────────────────────────────────
  // El borrado denegado NO deja registro
  // ────────────────────────────────────────────────────────────────

  describe('borrado denegado', () => {
    it('no registra nada cuando el ADC asignado lo intenta', async () => {
      const { adc, referido, doc } = await montar()

      const res = await borrar(referido, doc, adc)
      expect(res.status).toBe(403)

      expect(await auditoria().count()).toBe(0)
    })

    it('no registra nada cuando el postulante lo intenta fuera de PENDIENTE', async () => {
      const { postulante, referido, doc } = await montar({ estado: 'EN_REVISION' })

      const res = await borrar(referido, doc, postulante)
      expect(res.status).toBe(403)

      expect(await auditoria().count()).toBe(0)
    })

    it('no registra nada cuando el documento no existe', async () => {
      const { rrhh, referido } = await montar()

      const res = await borrar(referido, { id: 999999 }, rrhh)
      expect(res.status).toBe(404)

      expect(await auditoria().count()).toBe(0)
    })
  })

  // ────────────────────────────────────────────────────────────────
  // via_acceso: con que titulo se autorizo el borrado
  // ────────────────────────────────────────────────────────────────

  describe('via_acceso segun quien borro', () => {
    // Sin este caso la columna podria quedar siempre con el mismo valor y nadie
    // lo notaria, que es tanto como no tenerla.
    it('un privilegiado queda registrado como privilegiado', async () => {
      const { rrhh, referido, doc } = await montar()

      await borrar(referido, doc, rrhh)

      const [fila] = await auditoria().findAll()
      expect(fila.viaAcceso).toBe('privilegiado')
    })

    it('el creador del referido queda registrado como creador', async () => {
      const { creador, referido, doc } = await montar()

      await borrar(referido, doc, creador)

      const [fila] = await auditoria().findAll()
      expect(fila.viaAcceso).toBe('creador')
    })

    it('el postulante queda registrado como postulante', async () => {
      const { postulante, referido, doc } = await montar()

      await borrar(referido, doc, postulante)

      const [fila] = await auditoria().findAll()
      expect(fila.viaAcceso).toBe('postulante')
    })

    // Un solo escenario con tres documentos: montar tres expedientes completos
    // cuesta doce usuarios con bcrypt a coste 12 y se pasa del timeout.
    it('los tres valores son distintos entre si', async () => {
      const { rrhh, creador, postulante, referido, doc } = await montar()
      const otros = await Promise.all([2, 3].map(n => getModel('Documento').create({
        nombre: `extra-${n}.pdf`,
        ruta: `uploads/referidos/extra-${n}.pdf`,
        mimetype: 'application/pdf',
        referidoId: referido.id,
      })))

      await borrar(referido, doc, rrhh)
      await borrar(referido, otros[0], creador)
      await borrar(referido, otros[1], postulante)

      const vias = (await auditoria().findAll({ order: [['id', 'ASC']] })).map(f => f.viaAcceso)
      expect(vias).toEqual(['privilegiado', 'creador', 'postulante'])
    })
  })
})
