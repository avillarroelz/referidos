// backend/tests/integration/permisos-matriz.test.js
//
// Matriz de autorizacion por rol de los endpoints que no tenian red: kpis,
// roles, unidades, feedback, notificaciones, postulaciones, gmail y adjuntos.
//
// La suite recorre CADA endpoint contra CADA rol del sistema. Se afirma sobre la
// autorizacion y nada mas: un rol permitido no puede recibir 401 ni 403 (puede
// recibir 400 o 404 segun los datos, eso es otra capa), un rol no permitido
// recibe 403, y sin credenciales se recibe 401. Asi la suite no se rompe cuando
// cambian los datos de prueba, solo cuando cambian los permisos.
//
// La tabla se recorre en vez de escribirse caso por caso a proposito: agregar un
// endpoint a la matriz es una linea, y olvidarse de un rol deja de ser posible.

const request = require('supertest')
const { app } = require('../../src/app')
const db = require('../../src/db')
const { seedRoles, createTestUser, authHeader, ROLES_DEL_SISTEMA } = require('../helpers/auth')

const PRIVILEGIADOS = ['ADMIN', 'RRHH', 'JefeRRHH']
const SOLO_ADMIN = ['ADMIN']
const ADMIN_Y_RRHH = ['ADMIN', 'RRHH']
const CUALQUIER_AUTENTICADO = ROLES_DEL_SISTEMA

// Marcadores que se reemplazan por ids reales al construir cada peticion.
const ID_REFERIDO = ':referido'
const ID_USUARIO = ':usuario'

const ENDPOINTS = [
  // ── KPIs: tablero de gestion, reservado a los roles privilegiados ──
  // Salvo /overview, los handlers de kpis usan SQL de Postgres (date_trunc,
  // LEAD/EXTRACT) que revienta en SQLite. Da igual para esta suite: lo que se
  // afirma es que el rol permitido no recibe 401 ni 403, y con wrapHandlers ese
  // fallo sale como 500 en vez de dejar la peticion colgada.
  { grupo: 'kpis', method: 'get', path: '/api/kpis/overview', permitidos: PRIVILEGIADOS, esperado: 200 },
  // Los otros siete usan SQL de Postgres (date_trunc, LEAD/EXTRACT) y bajo
  // SQLite responden 500. Se verifica la autorizacion, que es lo que cubre esta
  // suite; validar su salida requiere la integracion sobre Postgres real, que
  // es la decision pendiente de la que dependen los 3 it.skip de kpis.test.js.
  ...['series', 'leadtime', 'funnel', 'conversion-rate', 'top-referrers', 'by-unit', 'sla']
    .map(recurso => ({
      grupo: 'kpis',
      method: 'get',
      path: `/api/kpis/${recurso}`,
      permitidos: PRIVILEGIADOS,
    })),

  // ── Roles y usuarios: leer es de ADMIN y RRHH, escribir solo de ADMIN ──
  { grupo: 'roles', method: 'get', path: '/api/roles', permitidos: ADMIN_Y_RRHH, esperado: 200 },
  { grupo: 'roles', method: 'get', path: '/api/roles/usuarios', permitidos: ADMIN_Y_RRHH, esperado: 200 },
  { grupo: 'roles', method: 'post', path: '/api/roles', permitidos: SOLO_ADMIN, body: { nombre: 'ROL_MATRIZ' } },
  { grupo: 'roles', method: 'delete', path: '/api/roles/999999', permitidos: SOLO_ADMIN },
  {
    grupo: 'roles', method: 'post', path: '/api/roles/usuarios', permitidos: SOLO_ADMIN,
    body: { username: 'nuevo', correo: 'nuevo@ecora.cl', password: 'ClaveLarga123!' },
  },
  { grupo: 'roles', method: 'patch', path: `/api/roles/usuarios/${ID_USUARIO}`, permitidos: SOLO_ADMIN, body: { username: 'x' } },
  {
    grupo: 'roles', method: 'patch', path: `/api/roles/usuarios/${ID_USUARIO}/password`,
    permitidos: SOLO_ADMIN, body: { password: 'OtraClaveLarga123!' },
  },
  { grupo: 'roles', method: 'post', path: `/api/roles/asignar/${ID_USUARIO}`, permitidos: SOLO_ADMIN, body: { rolId: 1 } },
  { grupo: 'roles', method: 'post', path: `/api/roles/quitar/${ID_USUARIO}`, permitidos: SOLO_ADMIN, body: { rolId: 1 } },

  // ── Unidades de negocio ──
  { grupo: 'unidades', method: 'get', path: '/api/unidades', permitidos: ADMIN_Y_RRHH, esperado: 200 },
  { grupo: 'unidades', method: 'post', path: '/api/unidades', permitidos: SOLO_ADMIN, body: { nombre: 'Unidad Matriz' } },
  { grupo: 'unidades', method: 'put', path: '/api/unidades/999999', permitidos: SOLO_ADMIN, body: { nombre: 'Otra' } },
  { grupo: 'unidades', method: 'delete', path: '/api/unidades/999999', permitidos: SOLO_ADMIN },
  { grupo: 'unidades', method: 'post', path: `/api/unidades/asignar/${ID_USUARIO}`, permitidos: ADMIN_Y_RRHH, body: { unidadId: 1 } },
  { grupo: 'unidades', method: 'post', path: `/api/unidades/quitar/${ID_USUARIO}`, permitidos: ADMIN_Y_RRHH, body: { unidadId: 1 } },

  // ── Feedback: cualquiera reporta, solo ADMIN administra ──
  { grupo: 'feedback', method: 'post', path: '/api/feedback', permitidos: CUALQUIER_AUTENTICADO, body: { mensaje: 'Un reporte de prueba', tipo: 'BUG' } },
  { grupo: 'feedback', method: 'get', path: '/api/feedback', permitidos: SOLO_ADMIN, esperado: 200 },
  { grupo: 'feedback', method: 'get', path: '/api/feedback/pendientes/count', permitidos: SOLO_ADMIN, esperado: 200 },
  { grupo: 'feedback', method: 'patch', path: '/api/feedback/999999/estado', permitidos: SOLO_ADMIN, body: { estado: 'RESUELTO' } },
  { grupo: 'feedback', method: 'get', path: '/api/feedback/999999/imagenes/0', permitidos: SOLO_ADMIN },

  // ── Notificaciones: son del propio usuario, cualquiera autenticado entra ──
  { grupo: 'notificaciones', method: 'get', path: '/api/notificaciones', permitidos: CUALQUIER_AUTENTICADO, esperado: 200 },
  { grupo: 'notificaciones', method: 'get', path: '/api/notificaciones/count', permitidos: CUALQUIER_AUTENTICADO, esperado: 200 },
  { grupo: 'notificaciones', method: 'patch', path: '/api/notificaciones/leer-todas', permitidos: CUALQUIER_AUTENTICADO },
  { grupo: 'notificaciones', method: 'patch', path: '/api/notificaciones/999999', permitidos: CUALQUIER_AUTENTICADO },

  // ── Postulaciones ──
  { grupo: 'postulaciones', method: 'get', path: '/api/postulaciones/mias', permitidos: CUALQUIER_AUTENTICADO, esperado: 200 },
  {
    grupo: 'postulaciones', method: 'post', path: '/api/postulaciones',
    permitidos: CUALQUIER_AUTENTICADO,
    body: { nombre: 'Postulante Matriz', email: 'matriz@test.com', cargoPostulado: 'Analista' },
  },

  // ── Gmail ──
  // auth-url incluye a JefeRRHH: el callback solo acepta la casilla de
  // reclutamiento. Sin esperado: su codigo depende de GMAIL_CLIENT_ID. process y preview se retiraron (ver mas abajo).
  { grupo: 'gmail', method: 'get', path: '/api/gmail/status', permitidos: PRIVILEGIADOS, esperado: 200 },
  { grupo: 'gmail', method: 'get', path: '/api/gmail/auth-url', permitidos: PRIVILEGIADOS },
]

// Los adjuntos van aparte: cuelgan de un referido y su controlador aplica
// ademas el criterio de acceso al referido, asi que el montaje se prepara para
// que todos los roles de la lista tengan acceso legitimo y el 403 que quede sea
// atribuible solo a requireRoles.
//
// La lectura y la subida ya cubren a los seis roles: JefeRRHH y ADC se
// agregaron al corregir la inconsistencia con src/lib/acceso.js (el aprobador
// no podia descargar el CV del candidato que debe dictaminar).
//
// El DELETE es mas estricto que la lectura, y esa asimetria es deliberada:
// puedeEliminarDocumentos exige privilegiado o creador siempre, y admite al
// postulante SOLO con el referido en PENDIENTE, que es el caso de este montaje.
// El ADC queda fuera aunque tenga el referido asignado: el evaluador puede
// aportar su informe, pero no eliminar la evidencia sobre la que dictamina.
//
// Los endpoints con docId 999999 afirman sobre AUTORIZACION, no sobre
// existencia: quien tiene permiso llega al controlador y recibe 404, y ese 404
// ya prueba que paso la guarda. Quien no lo tiene se queda en 403.
const ENDPOINTS_ADJUNTOS = [
  { grupo: 'adjuntos', method: 'get', path: `/api/referidos/${ID_REFERIDO}/adjuntos`, permitidos: ROLES_DEL_SISTEMA, esperado: 200 },
  { grupo: 'adjuntos', method: 'get', path: `/api/referidos/${ID_REFERIDO}/adjuntos/999999/download`, permitidos: ROLES_DEL_SISTEMA },
  { grupo: 'adjuntos', method: 'delete', path: `/api/referidos/${ID_REFERIDO}/adjuntos/999999`, permitidos: ['RRHH', 'ADMIN', 'JefeRRHH', 'TRABAJADOR', 'EXTERNO'] },
]

describe('Matriz de permisos por rol', () => {
  let getModel
  const usuarios = {}
  let referido
  let ajeno

  beforeAll(async () => {
    const instance = await db.__initTestDb()
    getModel = instance.getModel
    await db.__resetTestDb()
    await seedRoles(getModel)

    for (const rol of ROLES_DEL_SISTEMA) {
      usuarios[rol] = await createTestUser(getModel, {
        username: `matriz-${rol.toLowerCase()}`,
        correo: `matriz-${rol.toLowerCase()}@ecora.cl`,
        roles: [rol],
      })
    }

    // Referido con las cuatro relaciones legitimas de src/lib/acceso.js
    // representadas: lo creo el trabajador, el externo es el postulante, el ADC
    // esta asignado y los privilegiados entran por rol. Asi cualquier 403 que
    // aparezca es atribuible a requireRoles y no al acceso al referido.
    referido = await getModel('Referido').create({
      nombre: 'CANDIDATO MATRIZ',
      email: 'candidato.matriz@test.com',
      estado: 'PENDIENTE',
      creadoPorUserId: usuarios.TRABAJADOR.id,
      postulanteUserId: usuarios.EXTERNO.id,
      asignadoADCUserId: usuarios.ADC.id,
    })

    // Usuario sin ninguna relacion con ese referido: no lo creo, no es su
    // postulante y no lo tiene asignado. Es el que usa el impostor de mas
    // abajo, para que el 403 provenga del rol inventado y no de que el id
    // prestado tuviera un vinculo legitimo con el referido.
    ajeno = await createTestUser(getModel, {
      username: 'matriz-ajeno',
      correo: 'matriz-ajeno@ecora.cl',
      roles: ['TRABAJADOR'],
    })
  })

  afterAll(async () => {
    await db.__closeTestDb()
  })

  function construir({ method, path, body }, usuario) {
    const url = path
      .replace(ID_REFERIDO, String(referido.id))
      .replace(ID_USUARIO, String(usuarios.TRABAJADOR.id))

    let req = request(app)[method](url)
    if (usuario) req = req.set(authHeader(usuario))
    if (body) req = req.send(body)
    return req
  }

  const titulo = ({ method, path }) => `${method.toUpperCase()} ${path}`

  describe.each([...ENDPOINTS, ...ENDPOINTS_ADJUNTOS].map(e => [e.grupo, titulo(e), e]))(
    '%s — %s',
    (_grupo, _titulo, endpoint) => {
      it('sin credenciales responde 401', async () => {
        const res = await construir(endpoint, null)
        expect(res.status).toBe(401)
      })

      const permitidos = endpoint.permitidos
      const denegados = ROLES_DEL_SISTEMA.filter(r => !permitidos.includes(r))

      if (permitidos.length) {
        it.each(permitidos)('%s tiene acceso', async (rol) => {
          const res = await construir(endpoint, usuarios[rol])
          // Donde la respuesta es estable se fija el codigo exacto: si solo se
          // pidiera "ni 401 ni 403", un endpoint que empezara a responder 500
          // siempre seguiria pasando esta suite.
          if (endpoint.esperado) expect(res.status).toBe(endpoint.esperado)
          else expect([401, 403]).not.toContain(res.status)
        })
      }

      if (denegados.length) {
        it.each(denegados)('%s recibe 403', async (rol) => {
          const res = await construir(endpoint, usuarios[rol])
          expect(res.status).toBe(403)
        })
      }
    }
  )

  // Retiradas: recibian un refresh_token por body y repuntaban el singleton de
  // gmailService a otra cuenta de Google. Ningun rol las alcanza.
  describe.each([
    ['post', '/api/gmail/process'],
    ['post', '/api/gmail/preview'],
  ])('gmail — %s %s (retirada)', (method, path) => {
    it.each(ROLES_DEL_SISTEMA)('%s recibe 404', async (rol) => {
      const res = await construir({ method, path, body: {} }, usuarios[rol])
      expect(res.status).toBe(404)
    })
  })

  // Un token valido pero con un rol que no existe en el sistema no puede abrir
  // ningun endpoint restringido: la autorizacion tiene que ser lista blanca.
  describe('rol desconocido', () => {
    it.each(
      [...ENDPOINTS, ...ENDPOINTS_ADJUNTOS]
        .filter(e => e.permitidos !== CUALQUIER_AUTENTICADO)
        .map(e => [titulo(e), e])
    )('%s rechaza un rol inventado', async (_titulo, endpoint) => {
      // El id es el del usuario ajeno a proposito: si se prestara el del
      // creador del referido, los endpoints que autorizan por RELACION lo
      // dejarian pasar por ese vinculo y el caso ya no probaria lo que dice.
      const impostor = {
        id: ajeno.id,
        username: 'impostor',
        correo: 'impostor@ecora.cl',
        roles: [{ nombre: 'ROL_QUE_NO_EXISTE' }],
      }
      const res = await construir(endpoint, impostor)
      expect(res.status).toBe(403)
    })

    it('un ADC que no tiene el referido asignado no ve sus adjuntos', async () => {
      // El rol ADC pasa requireRoles, pero src/lib/acceso.js exige ademas ser el
      // aprobador ASIGNADO: tener el rol no da acceso a los referidos ajenos.
      const otroAdc = await createTestUser(getModel, {
        username: 'matriz-adc-ajeno',
        correo: 'matriz-adc-ajeno@ecora.cl',
        roles: ['ADC'],
      })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(otroAdc))

      expect(res.status).toBe(403)
    })

    it('un trabajador que no creo el referido tampoco ve sus adjuntos', async () => {
      const ajeno = await createTestUser(getModel, {
        username: 'matriz-trabajador-ajeno',
        correo: 'matriz-trabajador-ajeno@ecora.cl',
        roles: ['TRABAJADOR'],
      })

      const res = await request(app)
        .get(`/api/referidos/${referido.id}/adjuntos`)
        .set(authHeader(ajeno))

      expect(res.status).toBe(403)
    })

    it('un token sin roles tampoco abre un endpoint restringido', async () => {
      const sinRoles = { id: usuarios.TRABAJADOR.id, username: 'x', correo: 'x@ecora.cl', roles: [] }
      const res = await request(app).get('/api/roles').set(authHeader(sinRoles))
      expect(res.status).toBe(403)
    })
  })
})
