// backend/src/controllers/referidos.controller.js
const { Op } = require('sequelize')
const { body, param, query, validationResult } = require('express-validator')
const { sequelize, getModel } = require('../db')
const { ESTADOS, DICTAMEN_ADC, puedePasar } = require('../lib/estados')
const { puedeAccederReferido } = require('../lib/acceso')
const { detalleParaCliente, detalleOGenerico } = require('../lib/detalleError')
const gmailService = require('../services/gmailService')
const { guardarAdjuntosDeCorreo } = require('../services/gmailAdjuntos')
const { buscarCorreoRevisado, idsYaRevisados, anotarCorreoImportado } = require('../services/gmailRegistro')
const { config } = require('../config')
const { notificarCambioEstado, notificarAsignacion } = require('../services/notificationService')
const { verificarRut, crearVerificador, TEXTO_RECHAZO } = require('../services/listaBloqueo')

// Modelos
const Referido = getModel('Referido')
const Usuario = getModel('Usuario')
const EstadoHistorial = getModel('EstadoHistorial')

// ──────────────────────────────────────────────────────────────
// Validadores

const createValidators = [
  body('nombre').isString().notEmpty().withMessage('nombre es obligatorio'),
  body('email').optional().isEmail().withMessage('email inválido'),
  body('telefono').optional().isString(),
  body('rut').optional().isString(),
  body('cargoPostulado').optional().isString(),
  body('observaciones').optional().isString(),
]

const listValidators = [
  query('estado').optional().isString(),
  query('q').optional().isString(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  query('mine').optional().isIn(['1', 'true']),
  query('createdBy').optional().isString(), // 'me' o un id numérico
]

const getValidators = [ param('id').isInt({ gt: 0 }) ]

const changeValidators = [
  param('id').isInt({ gt: 0 }),
  body('nuevoEstado')
    .isString()
    .custom(v => Object.values(ESTADOS).includes(v))
    .withMessage('nuevoEstado inválido'),
  body('comentario').optional().isString(),
]

// ──────────────────────────────────────────────────────────────
// Helpers

function assertValid(res, req) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    console.log(`[req:${req.id || '-'}] [val]`, errors.array())
    return res.status(400).json({ errors: errors.array() })
  }
  return null
}

function rolesFromReq(req) {
  const roles = Array.isArray(req.auth?.roles) ? req.auth.roles : []
  const hasRRHH = roles.includes('RRHH')
  const hasADMIN = roles.includes('ADMIN')
  const hasADC = roles.includes('ADC')
  const hasJefeRRHH = roles.includes('JefeRRHH')
  return { roles, hasRRHH, hasADMIN, hasADC, hasJefeRRHH }
}

// La marca enListaBloqueo queda fuera de toda lectura (defaultScope del modelo);
// solo RRHH, JefeRRHH y ADMIN la piden explícitamente con scope('conMarca').
// Cualquier lectura nueva que serialice un Referido la excluye sin tocar nada.
function referidoVisiblePara(req) {
  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  return hasRRHH || hasADMIN || hasJefeRRHH ? Referido.scope('conMarca') : Referido
}

// ──────────────────────────────────────────────────────────────
// Stats rápidas (evita traer todos los registros)

async function getStats(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  console.log(`[req:${req.id || '-'}] [getStats] userId=${req.auth.id}`)

  try {
    const t0 = Date.now()

    // RRHH/Admin/JefeRRHH ven stats de todos; el resto solo los propios
    const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
    const canViewAll = hasRRHH || hasADMIN || hasJefeRRHH
    const whereClause = canViewAll ? {} : { creadoPorUserId: req.auth.id }

    const stats = await Referido.findAll({
      attributes: [
        'estado',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      where: whereClause,
      group: ['estado'],
      raw: true
    })

    // Convertir a objeto { PENDIENTE: 5, APROBADO: 3, ... }
    const byEstado = stats.reduce((acc, row) => {
      acc[row.estado] = parseInt(row.count, 10)
      return acc
    }, {})

    // Calcular totales
    const total = Object.values(byEstado).reduce((sum, n) => sum + n, 0)
    const pendientes = (byEstado.PENDIENTE || 0) + (byEstado.EN_REVISION || 0)
    const aprobados = (byEstado.APROBADO_JEFE || 0)
    const noAprobados = (byEstado.RECHAZADO || 0)
    const enProceso = (byEstado.ENVIADO_ADC || 0) + (byEstado.VALIDADO_ADC || 0)
      + (byEstado.RECHAZADO_ADC || 0) + (byEstado.CONTACTADO || 0) + (byEstado.APROBADO || 0)
    const contratados = byEstado.CONTRATADO || 0
    const noContratados = byEstado.NO_CONTRATADO || 0
    const listaEspera = byEstado.LISTA_ESPERA || 0

    const ms = Date.now() - t0
    console.log(`[req:${req.id || '-'}] [getStats] OK in ${ms}ms total=${total}`)

    return res.json({
      total,
      pendientes,
      aprobados,
      noAprobados,
      enProceso,
      contratados,
      noContratados,
      listaEspera,
      byEstado
    })
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [getStats] FAIL`, err)
    return res.status(500).json({ error: 'No se pudieron obtener las estadísticas' })
  }
}

// ──────────────────────────────────────────────────────────────
// Crear

async function create(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  // Antes de abrir la transacción: la consulta a black puede tardar hasta 5 s
  const { bloqueado } = await verificarRut(req.body.rut)
  // Respuesta idéntica a la falla genérica del catch: no revela que el RUT está bloqueado
  if (bloqueado) return res.status(500).json({ error: 'No se pudo crear el referido' })

  const t = await sequelize.transaction()
  try {
    const payload = {
      nombre: String(req.body.nombre || '').trim().toUpperCase(),
      email: req.body.email || null,
      telefono: req.body.telefono || null,
      rut: req.body.rut || null,
      cargoPostulado: req.body.cargoPostulado ? String(req.body.cargoPostulado).trim().toUpperCase() : null,
      observaciones: req.body.observaciones ? String(req.body.observaciones).trim().toUpperCase() : null,
      nombreReferidor: req.body.nombreReferidor || null,
      estado: ESTADOS.PENDIENTE,
      creadoPorUserId: req.auth.id,
    }

    const ref = await Referido.create(payload, { transaction: t })

    await EstadoHistorial.create({
      referidoId: ref.id,
      actorUserId: req.auth.id,
      desde: ESTADOS.PENDIENTE,
      hacia: ESTADOS.PENDIENTE,
      comentario: 'Creación de referido',
    }, { transaction: t })

    await t.commit()
    console.log(`[req:${req.id || '-'}] [create] OK id=${ref.id}`)
    // La instancia recién creada trae todas las columnas: se quita la marca
    const creado = ref.toJSON()
    delete creado.enListaBloqueo
    return res.status(201).json(creado)
  } catch (err) {
    await t.rollback()
    console.error(`[req:${req.id || '-'}] [create] FAIL`, err)

    // Manejar error de restricción única (RUT duplicado, etc.)
    if (err.name === 'SequelizeUniqueConstraintError') {
      const field = err.errors[0]?.path || 'campo'
      const value = err.errors[0]?.value || ''
      console.log(`[req:${req.id || '-'}] [create] Duplicate ${field}=${value}`)
      return res.status(409).json({
        error: `El ${field} "${value}" ya existe en el sistema`,
        field: field,
        value: value
      })
    }

    return res.status(500).json({ error: 'No se pudo crear el referido' })
  }
}

// ──────────────────────────────────────────────────────────────
// Listar

async function list(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { estado, q, from, to } = req.query
  const page = Number(req.query.page) || 1
  const limit = Number(req.query.limit) || 25
  const offset = (page - 1) * limit
  const where = {}


  if (estado) where.estado = estado

  if (q) {
    where[Op.or] = [
      { nombre: { [Op.iLike]: `%${q}%` } },
      { email: { [Op.iLike]: `%${q}%` } },
      { telefono: { [Op.iLike]: `%${q}%` } },
      { rut: { [Op.iLike]: `%${q}%` } },
      { cargoPostulado: { [Op.iLike]: `%${q}%` } },
    ]
  }

  if (from || to) {
    where.created_at = {}
    if (from) where.created_at[Op.gte] = from
    if (to) where.created_at[Op.lte] = to
  }

  // “Mis referidos” / por creador
  const mine = String(req.query.mine || '').toLowerCase()
  const createdBy = req.query.createdBy
  const pideSoloMis = (mine === '1' || mine === 'true' || createdBy === 'me')

  if (pideSoloMis) {
    where.creadoPorUserId = req.auth.id
  } else if (createdBy && createdBy !== 'me' && /^\d+$/.test(createdBy)) {
    where.creadoPorUserId = Number(createdBy)
  }

  const { roles, hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  console.log(`[req:${req.id || '-'}] [list] userId=${req.auth.id} roles=`, roles, 'pideSoloMis=', pideSoloMis, 'page=', page, 'limit=', limit)

  // Permiso final: no RRHH/ADMIN/JefeRRHH y no pidió “solo mis” → 403
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH && !pideSoloMis) {
    console.log(`[req:${req.id || '-'}] [list] 403 – no RRHH/ADMIN y no pidió ?mine=1`)
    return res.status(403).json({ error: 'Acceso restringido: usa ?mine=1 para ver tus referidos' })
  }

  try {
    const t0 = Date.now()
    const Documento = getModel('Documento')
    const { rows, count } = await referidoVisiblePara(req).findAndCountAll({
      where,
      include: [
        { model: Usuario, as: 'creadoPor', attributes: ['id', 'username', 'correo'] },
        { model: Usuario, as: 'adcAsignado', attributes: ['id', 'username', 'correo'] },
        { model: Documento, as: 'adjuntos', attributes: ['id', 'nombre', 'ruta', 's3Key', 'mimetype', 'size'] }
      ],
      order: [['id', 'DESC']],
      limit,
      distinct: true,
      offset,
    })
    const ms = Date.now() - t0
    console.log(`[req:${req.id || '-'}] [list] OK total=${count} in ${ms}ms`)

    // Agregar conteo de adjuntos a cada referido
    const dataWithCount = rows.map(r => {
      const plain = r.toJSON()
      plain.adjuntos_count = plain.adjuntos?.length || 0
      return plain
    })

    return res.json({ data: dataWithCount, page, limit, total: count })
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [list] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo obtener el listado' })
  }
}

// ──────────────────────────────────────────────────────────────
// Detalle

async function getById(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  console.log(`[req:${req.id || '-'}] [getById] id=${req.params.id}`)

  try {
    const ref = await referidoVisiblePara(req).findByPk(Number(req.params.id), {
      include: [
        { model: Usuario, as: 'creadoPor', attributes: ['id', 'username', 'correo'] },
        { model: Usuario, as: 'adcAsignado', attributes: ['id', 'username', 'correo'] },
        {
          model: EstadoHistorial,
          as: 'historial',
          include: [{ model: Usuario, as: 'actor', attributes: ['id', 'username', 'correo'] }],
          separate: true,
          order: [['id', 'ASC']],
        },
      ],
    })
    if (!ref) {
      console.log(`[req:${req.id || '-'}] [getById] 404`)
      return res.status(404).json({ error: 'No encontrado' })
    }

    // Criterio unico de acceso (lib/acceso): privilegiado, creador, postulante
    // externo o ADC asignado
    if (!puedeAccederReferido(req.auth, ref)) {
      console.log(`[req:${req.id || '-'}] [getById] 403 – sin permiso`)
      return res.status(403).json({ error: 'Sin permisos para ver este referido' })
    }

    console.log(`[req:${req.id || '-'}] [getById] OK`)
    return res.json(ref)
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [getById] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo obtener el referido' })
  }
}

// ──────────────────────────────────────────────────────────────
// Cambiar estado

async function changeState(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  console.log(`[req:${req.id || '-'}] [changeState] id=${req.params.id} body=`, req.body)

  const t = await sequelize.transaction()
  try {
    const id = Number(req.params.id)
    const { nuevoEstado, comentario = null } = req.body

    const ref = await Referido.findByPk(id, { transaction: t })
    if (!ref) {
      await t.rollback()
      console.log(`[req:${req.id || '-'}] [changeState] 404`)
      return res.status(404).json({ error: 'No encontrado' })
    }

    // CONTRATADO y NO_CONTRATADO solo se asignan desde el sistema de reclutamiento externo
    if (nuevoEstado === 'CONTRATADO' || nuevoEstado === 'NO_CONTRATADO') {
      await t.rollback()
      console.log(`[req:${req.id || '-'}] [changeState] bloqueado: ${nuevoEstado} solo vía integración externa`)
      return res.status(400).json({ error: `El estado ${nuevoEstado} solo puede ser asignado por el sistema de reclutamiento externo` })
    }

    // Los estados del ciclo ADC tienen un unico camino legitimo; el cambio manual
    // los saltaria (dictamen sin dictamen, envio sin ADC).
    if (nuevoEstado === 'ENVIADO_ADC') {
      await t.rollback()
      return res.status(400).json({ error: 'Para enviar a ADC usa Asignar Aprobador' })
    }
    if (nuevoEstado === 'VALIDADO_ADC' || nuevoEstado === 'RECHAZADO_ADC') {
      await t.rollback()
      return res.status(400).json({ error: `El estado ${nuevoEstado} solo puede fijarse mediante el dictamen del Aprobador asignado` })
    }

    // Solo JefeRRHH (o ADMIN) puede aprobar/rechazar/lista de espera desde EN_REVISION
    const { hasJefeRRHH, hasADMIN: isAdmin } = rolesFromReq(req)
    const JEFE_ONLY_TRANSITIONS = ['APROBADO_JEFE', 'LISTA_ESPERA']
    if (ref.estado === 'EN_REVISION' && JEFE_ONLY_TRANSITIONS.includes(nuevoEstado)) {
      if (!hasJefeRRHH && !isAdmin) {
        await t.rollback()
        console.log(`[req:${req.id || '-'}] [changeState] bloqueado: solo JefeRRHH o ADMIN pueden aprobar/lista de espera`)
        return res.status(403).json({ error: 'Solo el Jefe RRHH puede aprobar, rechazar o enviar a lista de espera' })
      }
    }
    // Solo JefeRRHH o ADMIN puede rechazar desde EN_REVISION
    if (ref.estado === 'EN_REVISION' && nuevoEstado === 'RECHAZADO') {
      if (!hasJefeRRHH && !isAdmin) {
        await t.rollback()
        console.log(`[req:${req.id || '-'}] [changeState] bloqueado: solo JefeRRHH o ADMIN pueden rechazar desde EN_REVISION`)
        return res.status(403).json({ error: 'Solo el Jefe RRHH puede rechazar referidos en revisión' })
      }
    }

    if (!puedePasar(ref.estado, nuevoEstado)) {
      await t.rollback()
      console.log(`[req:${req.id || '-'}] [changeState] transición inválida ${ref.estado} → ${nuevoEstado}`)
      return res.status(400).json({ error: `Transición inválida: ${ref.estado} → ${nuevoEstado}` })
    }

    const anterior = ref.estado
    ref.estado = nuevoEstado
    await ref.save({ transaction: t })

    await EstadoHistorial.create({
      referidoId: ref.id,
      actorUserId: req.auth.id,
      desde: anterior,
      hacia: nuevoEstado,
      comentario,
    }, { transaction: t })

    await t.commit()

    // Notificación de cambio de estado (no bloqueante)
    notificarCambioEstado(ref, anterior, nuevoEstado, req.auth.id).catch(err =>
      console.error('[changeState] notificación FAIL:', err.message)
    )

    console.log(`[req:${req.id || '-'}] [changeState] OK ${anterior} → ${nuevoEstado}`)
    return res.json({ ok: true, id: ref.id, estado: ref.estado })
  } catch (err) {
    await t.rollback()
    console.error(`[req:${req.id || '-'}] [changeState] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo cambiar el estado' })
  }
}

// ──────────────────────────────────────────────────────────────
// Historial plano

async function getHistorial(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  console.log(`[req:${req.id || '-'}] [getHistorial] id=${req.params.id}`)

  try {
    // Verificar autorización antes de devolver historial
    const ref = await Referido.findByPk(Number(req.params.id), { attributes: ['id', 'creadoPorUserId', 'postulanteUserId', 'asignadoADCUserId'] })
    if (!ref) return res.status(404).json({ error: 'Referido no encontrado' })

    if (!puedeAccederReferido(req.auth, ref)) {
      console.log(`[req:${req.id || '-'}] [getHistorial] 403 – sin permiso`)
      return res.status(403).json({ error: 'Sin permisos para ver este historial' })
    }

    const data = await EstadoHistorial.findAll({
      where: { referidoId: ref.id },
      include: [{ model: Usuario, as: 'actor', attributes: ['id', 'username', 'correo'] }],
      order: [['id', 'ASC']],
    })
    console.log(`[req:${req.id || '-'}] [getHistorial] OK len=${data.length}`)
    return res.json(data)
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [getHistorial] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo obtener el historial' })
  }
}

// ──────────────────────────────────────────────────────────────
// Sincronizar referidos desde Gmail

const syncGmailValidators = [
  body('query').optional().isString(),
  body('maxResults').optional().isInt({ min: 1, max: 100 }).toInt(),
  body('autoMarkRead').optional().isBoolean(),
  body('addLabel').optional().isBoolean(),
  body('skipDuplicates').optional().isBoolean(),
]

// Idempotencia del import: un correo de Gmail se importa una sola vez.
async function referidoYaImportado(messageId) {
  const existente = await Referido.findOne({ where: { gmailMessageId: messageId } })
  return existente ? `Duplicado: ya importado como referido #${existente.id}` : null
}

// Dos imports concurrentes del mismo correo pasan el chequeo previo y el
// segundo create choca con el indice UNIQUE: se reporta como Duplicado. Solo
// ese indice: un UNIQUE de otra tabla (historial, documentos) es un error real.
async function duplicadoPorCarrera(err, messageId) {
  if (err.name !== 'SequelizeUniqueConstraintError') return null
  const esDelMessageId = err.parent?.constraint === 'referidos_gmail_message_id_unique'
    || err.errors?.some(e => e.path === 'gmail_message_id')
  if (!esDelMessageId) return null
  return referidoYaImportado(messageId).catch(() => null)
}

async function syncFromGmail(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { roles, hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)

  // Solo RRHH, JefeRRHH o ADMIN pueden sincronizar desde Gmail
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    console.log(`[req:${req.id || '-'}] [syncFromGmail] 403 – requiere RRHH, JefeRRHH o ADMIN`)
    return res.status(403).json({ error: 'Acceso restringido: se requiere rol RRHH, JefeRRHH o ADMIN' })
  }


  try {
    // Usar token centralizado (Secrets Manager, archivo local o .env)
    const { getSyncRefreshToken } = require('./gmailController')
    const syncRefreshToken = await getSyncRefreshToken()

    if (!syncRefreshToken) {
      console.log(`[req:${req.id || '-'}] [syncFromGmail] Gmail no configurado`)
      return res.status(400).json({
        error: 'Gmail no configurado. Un administrador debe conectar el correo de sincronizacion.',
        requiresSetup: true
      })
    }

    // Inicializar Gmail Service con el token centralizado
    const credentials = {
      client_id: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI,
      refresh_token: syncRefreshToken
    }

    await gmailService.initialize(credentials)

    // Opciones de sincronización
    const options = {
      query: req.body.query || 'subject:referido is:unread',
      maxResults: req.body.maxResults || 50,
      autoMarkRead: req.body.autoMarkRead !== false,
      addLabel: req.body.addLabel !== false,
      skipDuplicates: req.body.skipDuplicates !== false
    }

    console.log(`[req:${req.id || '-'}] [syncFromGmail] procesando con opciones:`, options)

    // Buscar correos
    const messages = await gmailService.searchEmails(options.query, options.maxResults)
    if (!messages || messages.length === 0) {
      return res.json({ ok: true, message: 'No se encontraron correos', processed: 0, created: 0, skipped: 0, errors: [] })
    }

    const results = { processed: 0, created: 0, skipped: 0, errors: [] }
    const verificarEnLote = crearVerificador()

    for (let i = 0; i < messages.length; i++) {
      try {
        const duplicado = await referidoYaImportado(messages[i].id)
        if (duplicado) {
          results.errors.push({ messageId: messages[i].id, error: duplicado })
          continue
        }

        // Descartado (o adjuntado a otra ficha) en la bandeja: no vuelve a entrar.
        if (await buscarCorreoRevisado(messages[i].id)) {
          results.skipped++
          continue
        }

        const emailData = await gmailService.processOneEmail(messages[i].id)
        results.processed++

        const d = emailData.extractedData
        if (!d.nombre) {
          results.errors.push({ messageId: messages[i].id, error: 'Sin nombre detectado' })
          continue
        }

        // Verificar duplicados
        if (options.skipDuplicates) {
          const dupWhere = []
          if (d.rut) dupWhere.push({ rut: d.rut })
          if (d.email) dupWhere.push({ email: d.email })
          if (dupWhere.length > 0) {
            const existing = await Referido.findOne({ where: { [Op.or]: dupWhere } })
            if (existing) { results.skipped++; continue }
          }
        }

        // Lista de no recontratación: no se crea ni se anota el correo
        if ((await verificarEnLote(d.rut)).bloqueado) {
          results.errors.push({ messageId: messages[i].id, error: TEXTO_RECHAZO })
          continue
        }

        const creado = await Referido.create({
          nombre: d.nombre.trim(),
          email: d.email || null,
          telefono: d.telefono || null,
          rut: d.rut || null,
          cargoPostulado: d.cargoPostulado || null,
          observaciones: d.observaciones || null,
          nombreReferidor: d.nombreReferidor || null,
          estado: ESTADOS.PENDIENTE,
          creadoPorUserId: req.auth.id,
          gmailMessageId: messages[i].id
        })
        results.created++

        await anotarCorreoImportado({
          messageId: messages[i].id,
          from: emailData.from,
          subject: emailData.subject,
          referidoId: creado.id,
          userId: req.auth.id,
        })

        if (options.autoMarkRead) await gmailService.markAsRead(messages[i].id)
        if (options.addLabel) await gmailService.addLabel(messages[i].id, 'Referido-Procesado')

        // Throttle entre correos
        if (i < messages.length - 1) await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        const duplicado = await duplicadoPorCarrera(err, messages[i].id)
        results.errors.push({ messageId: messages[i].id, error: duplicado || detalleOGenerico(err, 'No se pudo procesar el correo') })
      }
    }

    const message = `Se procesaron ${results.processed} correos: ${results.created} creados${results.skipped > 0 ? `, ${results.skipped} duplicados omitidos` : ''}${results.errors.length > 0 ? `, ${results.errors.length} con errores` : ''}`
    console.log(`[req:${req.id || '-'}] [syncFromGmail] OK: ${message}`)

    return res.json({
      ok: true,
      message,
      ...results
    })

  } catch (err) {
    console.error(`[req:${req.id || '-'}] [syncFromGmail] FAIL`, err)

    // Error específico de Gmail API
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      return res.status(401).json({
        error: 'Credenciales de Google inválidas o expiradas. Vuelve a autenticarte.',
        requiresAuth: true
      })
    }

    return res.status(500).json({
      error: 'No se pudieron sincronizar los referidos desde Gmail',
      details: detalleParaCliente(err)
    })
  }
}

// ──────────────────────────────────────────────────────────────
// Preview de correos de Gmail

const previewGmailValidators = [
  query('q').optional().isString(),
  query('maxResults').optional().isInt({ min: 1 }).toInt(),
]

// Tope de ids que se piden a Gmail antes de excluir los ya revisados. Con 500 la
// bandeja quedaba vacía en cuanto había 500 revisados recientes, aunque hubiera
// correos pendientes más antiguos.
const MAX_IDS_LISTADOS = 2000

// `preguntas` llega como JSON en el query string. Devuelve el arreglo limpio
// (vacío si no vino) o null si no cumple: 1-5 textos de 1-200 caracteres.
function parsePreguntas(raw) {
  if (raw === undefined) return []
  if (typeof raw !== 'string') return null
  let lista
  try { lista = JSON.parse(raw) } catch { return null }
  if (!Array.isArray(lista) || lista.length < 1 || lista.length > 5) return null
  const limpias = []
  for (const p of lista) {
    if (typeof p !== 'string') return null
    const t = p.trim()
    if (t.length < 1 || t.length > 200) return null
    limpias.push(t)
  }
  return limpias
}

// Referido existente con el mismo email o RUT que extrajo el análisis.
async function buscarYaRegistrado(extracted = {}) {
  const where = []
  if (extracted.rut) where.push({ rut: extracted.rut })
  if (extracted.email) where.push({ email: extracted.email })
  if (where.length === 0) return null
  const existente = await Referido.findOne({ where: { [Op.or]: where }, attributes: ['id', 'nombre'] })
  return existente ? { id: existente.id, nombre: existente.nombre } : null
}

async function previewGmail(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    return res.status(403).json({ error: 'Acceso restringido: se requiere rol RRHH, JefeRRHH o ADMIN' })
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Los headers SSE ya salieron: un error de validación se informa como evento.
  const preguntas = parsePreguntas(req.query.preguntas)
  if (!preguntas) {
    send('error', { error: 'Preguntas no válidas' })
    return res.end()
  }

  try {
    const { getSyncRefreshToken } = require('./gmailController')
    const syncRefreshToken = await getSyncRefreshToken()

    if (!syncRefreshToken) {
      send('error', { error: 'Gmail no configurado. Un administrador debe conectar el correo de sincronizacion.', requiresSetup: true })
      return res.end()
    }

    await gmailService.initialize({
      client_id: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI,
      refresh_token: syncRefreshToken
    })

    const searchQuery = req.query.q || 'in:inbox after:2025/01/01'
    const maxResults = Number(req.query.maxResults) || 500
    // Se lista hasta el tope y se corta a maxResults DESPUÉS de excluir los ya
    // revisados: si no, los primeros N siempre serían los mismos ya revisados.
    const listados = await gmailService.searchEmails(searchQuery, MAX_IDS_LISTADOS)

    if (!listados || listados.length === 0) {
      send('done', { count: 0 })
      return res.end()
    }

    const revisados = await idsYaRevisados(listados.map(m => m.id))
    const pendientes = listados.filter(m => !revisados.has(m.id))
    const messages = pendientes.slice(0, maxResults)
    const omitidos = listados.length - pendientes.length

    send('total', { total: messages.length, omitidos })
    console.log(`[previewGmail] Procesando ${messages.length} correos con SSE (${omitidos} omitidos por ya revisados)...`)

    let count = 0
    for (let i = 0; i < messages.length; i++) {
      // Verificar si el cliente desconectó
      if (req.socket.destroyed) {
        console.log('[previewGmail] Cliente desconectado, abortando')
        return
      }

      try {
        const result = await gmailService.processOneEmail(messages[i].id, preguntas)
        count++
        const yaRegistrado = await buscarYaRegistrado(result.extractedData)
        send('email', {
          index: i,
          total: messages.length,
          email: { ...result, respuestas: result.respuestas || [], yaRegistrado },
        })
        console.log(`[previewGmail] ${i + 1}/${messages.length} - ${result.parseSource}`)
      } catch (err) {
        console.warn(`[previewGmail] Error en correo ${messages[i].id}:`, err.message)
        send('email_error', { index: i, total: messages.length, messageId: messages[i].id, error: detalleOGenerico(err, 'No se pudo procesar el correo') })
      }

      // Throttle: 800ms entre llamadas IA para evitar 429
      if (i < messages.length - 1) {
        await new Promise(r => setTimeout(r, 800))
      }
    }

    send('done', { count })
    return res.end()

  } catch (err) {
    console.error(`[previewGmail] FAIL`, err)

    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      send('error', { error: 'Credenciales de Google inválidas o expiradas', requiresAuth: true })
    } else {
      send('error', { error: 'No se pudo obtener preview de correos', details: detalleParaCliente(err) })
    }
    return res.end()
  }
}

// ──────────────────────────────────────────────────────────────
// Sincronizar referidos desde Gmail (manual - con datos editados por el usuario)

const syncGmailManualValidators = [
  body('referidos').isArray({ min: 1 }).withMessage('referidos es obligatorio'),
  body('referidos.*.messageId').isString().withMessage('messageId obligatorio'),
  body('referidos.*.nombre').isString().notEmpty().withMessage('nombre obligatorio'),
  body('referidos.*.email').optional({ nullable: true }).isString(),
  body('referidos.*.telefono').optional({ nullable: true }).isString(),
  body('referidos.*.rut').optional({ nullable: true }).isString(),
  body('referidos.*.cargoPostulado').optional({ nullable: true }).isString(),
  body('referidos.*.observaciones').optional({ nullable: true }).isString(),
  body('referidos.*.nombreReferidor').optional({ nullable: true }).isString(),
  body('referidos.*.from').optional({ nullable: true }).isString(),
  body('referidos.*.subject').optional({ nullable: true }).isString(),
]

async function syncFromGmailManual(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    return res.status(403).json({ error: 'Acceso restringido: se requiere rol RRHH, JefeRRHH o ADMIN' })
  }

  const { referidos: referidosInput } = req.body
  console.log(`[req:${req.id || '-'}] [syncGmailManual] userId=${req.auth.id} count=${referidosInput.length}`)

  // Inicializar Gmail para descargar adjuntos
  const { getSyncRefreshToken } = require('./gmailController')
  const syncRefreshToken = await getSyncRefreshToken()
  if (syncRefreshToken) {
    await gmailService.initialize({
      client_id: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GMAIL_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI,
      refresh_token: syncRefreshToken
    })
  }

  const results = { created: 0, adjuntosGuardados: 0, errors: [], referidos: [] }
  const verificarEnLote = crearVerificador()

  for (const item of referidosInput) {
    try {
      const duplicado = await referidoYaImportado(item.messageId)
      if (duplicado) {
        results.errors.push({ messageId: item.messageId, nombre: item.nombre, error: duplicado })
        continue
      }

      // Importado en el registro (p. ej. adjuntado a otra ficha): no se crea otra
      // persona ni se pisa su referidoId. Un descartado sí se puede importar.
      const revisado = await buscarCorreoRevisado(item.messageId)
      if (revisado?.estado === 'importado') {
        results.errors.push({ messageId: item.messageId, nombre: item.nombre, error: 'Duplicado: este correo ya fue importado' })
        continue
      }

      // Verificar duplicados por RUT o email
      const duplicateWhere = []
      if (item.rut) duplicateWhere.push({ rut: item.rut })
      if (item.email) duplicateWhere.push({ email: item.email })

      if (duplicateWhere.length > 0) {
        const existing = await Referido.findOne({ where: { [Op.or]: duplicateWhere } })
        if (existing) {
          results.errors.push({
            messageId: item.messageId,
            nombre: item.nombre,
            error: `Duplicado: ya existe referido #${existing.id}`
          })
          continue
        }
      }

      // Lista de no recontratación: no se crea ni se anota el correo
      if ((await verificarEnLote(item.rut)).bloqueado) {
        results.errors.push({ messageId: item.messageId, nombre: item.nombre, error: TEXTO_RECHAZO })
        continue
      }

      const referido = await Referido.create({
        nombre: item.nombre.trim(),
        email: item.email || null,
        telefono: item.telefono || null,
        rut: item.rut || null,
        cargoPostulado: item.cargoPostulado || null,
        observaciones: item.observaciones || null,
        nombreReferidor: item.nombreReferidor || null,
        estado: ESTADOS.PENDIENTE,
        creadoPorUserId: req.auth.id,
        gmailMessageId: item.messageId
      })

      await EstadoHistorial.create({
        referidoId: referido.id,
        actorUserId: req.auth.id,
        desde: ESTADOS.PENDIENTE,
        hacia: ESTADOS.PENDIENTE,
        comentario: 'Importado desde Gmail (con revision manual)',
      })

      await anotarCorreoImportado({
        messageId: item.messageId,
        from: item.from,
        subject: item.subject,
        referidoId: referido.id,
        userId: req.auth.id,
      })

      // ── Descargar y guardar adjuntos del correo ──
      if (syncRefreshToken) {
        try {
          results.adjuntosGuardados += await guardarAdjuntosDeCorreo(item.messageId, referido)
        } catch (attErr) {
          console.warn(`[syncGmailManual] Error guardando adjuntos de ${item.messageId}:`, attErr.message)
        }
      }

      results.created++
      results.referidos.push({
        id: referido.id,
        nombre: referido.nombre,
        email: referido.email,
        rut: referido.rut,
        messageId: item.messageId
      })
    } catch (err) {
      const duplicado = await duplicadoPorCarrera(err, item.messageId)
      if (!duplicado) console.error(`[syncGmailManual] Error creando referido:`, err.message)
      results.errors.push({
        messageId: item.messageId,
        nombre: item.nombre,
        error: duplicado || detalleOGenerico(err, 'No se pudo procesar el referido')
      })
    }
  }

  // Marcar correos como leidos
  try {
    if (syncRefreshToken) {
      const messageIds = results.referidos.map(r => r.messageId)
      for (const msgId of messageIds) {
        await gmailService.markAsRead(msgId)
        await gmailService.addLabel(msgId, 'Referido-Procesado')
      }
    }
  } catch (err) {
    console.warn('[syncGmailManual] Error marcando correos:', err.message)
  }

  const message = `${results.created} referido(s) importado(s), ${results.adjuntosGuardados} archivo(s) guardado(s)${results.errors.length > 0 ? `, ${results.errors.length} con errores` : ''}`
  console.log(`[req:${req.id || '-'}] [syncGmailManual] OK: ${message}`)

  return res.json({ ok: true, message, ...results })
}

// ──────────────────────────────────────────────────────────────
// Marcar como enviado a ADC

const enviarADCValidators = [
  param('id').isInt({ gt: 0 }),
  body('enviadoADC').isBoolean().withMessage('enviadoADC debe ser un booleano'),
]

async function enviarADC(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    return res.status(403).json({ error: 'Solo RRHH, JefeRRHH o ADMIN pueden enviar a ADC' })
  }

  console.log(`[req:${req.id || '-'}] [enviarADC] id=${req.params.id} enviadoADC=${req.body.enviadoADC}`)

  try {
    const id = Number(req.params.id)
    const { enviadoADC } = req.body

    const ref = await Referido.findByPk(id)
    if (!ref) {
      console.log(`[req:${req.id || '-'}] [enviarADC] 404`)
      return res.status(404).json({ error: 'No encontrado' })
    }

    ref.enviadoADC = enviadoADC
    await ref.save()

    console.log(`[req:${req.id || '-'}] [enviarADC] OK enviadoADC=${enviadoADC}`)
    return res.json({ ok: true, id: ref.id, enviadoADC: ref.enviadoADC })
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [enviarADC] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo actualizar el referido' })
  }
}

// ──────────────────────────────────────────────────────────────
// Asignar referido a un ADC específico

const asignarADCValidators = [
  param('id').isInt({ gt: 0 }),
  body('adcUserId').isInt({ gt: 0 }).withMessage('adcUserId es obligatorio'),
]

async function asignarADC(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    return res.status(403).json({ error: 'Solo RRHH, JefeRRHH o ADMIN pueden asignar a ADC' })
  }

  const t = await sequelize.transaction()
  try {
    const id = Number(req.params.id)
    const { adcUserId } = req.body

    const ref = await Referido.findByPk(id, { transaction: t })
    if (!ref) {
      await t.rollback()
      return res.status(404).json({ error: 'Referido no encontrado' })
    }

    // Validar que el usuario destino tenga rol ADC
    const adcUser = await Usuario.findByPk(adcUserId, {
      include: [{ association: 'roles' }],
    })
    if (!adcUser) {
      await t.rollback()
      return res.status(404).json({ error: 'Usuario ADC no encontrado' })
    }
    const esADC = adcUser.roles?.some(r => r.nombre === 'ADC')
    if (!esADC) {
      await t.rollback()
      return res.status(400).json({ error: 'El usuario seleccionado no tiene rol ADC' })
    }

    // La maquina de estados solo permite llegar a ENVIADO_ADC desde APROBADO_JEFE
    if (ref.estado !== ESTADOS.APROBADO_JEFE) {
      await t.rollback()
      return res.status(409).json({ error: `Solo se puede asignar un ADC a un referido en estado APROBADO_JEFE (actual: ${ref.estado})` })
    }

    // Calcular SLA deadline
    const slaDays = config.sla.adcResponseDays
    const slaDeadline = new Date()
    slaDeadline.setDate(slaDeadline.getDate() + slaDays)

    const anterior = ref.estado
    ref.asignadoADCUserId = adcUserId
    ref.fechaEnvioADC = new Date()
    ref.slaDeadline = slaDeadline
    ref.enviadoADC = true
    ref.estado = ESTADOS.ENVIADO_ADC

    await EstadoHistorial.create({
      referidoId: ref.id,
      actorUserId: req.auth.id,
      desde: anterior,
      hacia: ESTADOS.ENVIADO_ADC,
      comentario: `Asignado a ADC: ${adcUser.username}`,
    }, { transaction: t })

    await ref.save({ transaction: t })
    await t.commit()

    // Notificaciones
    notificarAsignacion(ref, adcUserId).catch(err =>
      console.error('[asignarADC] notificación FAIL:', err.message)
    )
    if (anterior !== ref.estado) {
      notificarCambioEstado(ref, anterior, ref.estado, req.auth.id).catch(err =>
        console.error('[asignarADC] notificación cambio FAIL:', err.message)
      )
    }

    console.log(`[req:${req.id || '-'}] [asignarADC] OK ref=${id} adc=${adcUserId}`)
    return res.json({ ok: true, id: ref.id, asignadoADCUserId: adcUserId, estado: ref.estado, slaDeadline })
  } catch (err) {
    await t.rollback()
    console.error(`[req:${req.id || '-'}] [asignarADC] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo asignar al ADC' })
  }
}

// ──────────────────────────────────────────────────────────────
// Dictamen ADC

const dictaminarValidators = [
  param('id').isInt({ gt: 0 }),
  body('dictamen')
    .isString()
    .custom(v => Object.values(DICTAMEN_ADC).includes(v))
    .withMessage('dictamen inválido'),
  body('comentario').optional().isString(),
]

async function dictaminar(req, res) {
  if (assertValid(res, req)) return
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasADC } = rolesFromReq(req)
  if (!hasADC) {
    return res.status(403).json({ error: 'Solo usuarios ADC pueden emitir dictamen' })
  }

  const t = await sequelize.transaction()
  try {
    const id = Number(req.params.id)
    const { dictamen, comentario = null } = req.body

    const ref = await Referido.findByPk(id, { transaction: t })
    if (!ref) {
      await t.rollback()
      return res.status(404).json({ error: 'Referido no encontrado' })
    }

    // Validar que el ADC sea el asignado
    if (ref.asignadoADCUserId !== req.auth.id) {
      await t.rollback()
      return res.status(403).json({ error: 'No eres el ADC asignado a este referido' })
    }

    // Validar que esté en ENVIADO_ADC
    if (ref.estado !== ESTADOS.ENVIADO_ADC) {
      await t.rollback()
      return res.status(400).json({ error: `No se puede dictaminar en estado ${ref.estado}` })
    }

    const anterior = ref.estado
    ref.dictamenADC = dictamen
    ref.fechaRespuestaADC = new Date()

    // Determinar nuevo estado según dictamen
    if (dictamen === DICTAMEN_ADC.CUMPLE || dictamen === DICTAMEN_ADC.CUMPLE_PARCIAL) {
      ref.estado = ESTADOS.VALIDADO_ADC
    } else {
      ref.estado = ESTADOS.RECHAZADO_ADC
    }

    await ref.save({ transaction: t })

    const dictamenLabel = dictamen === 'CUMPLE' ? 'CUMPLE' : dictamen === 'CUMPLE_PARCIAL' ? 'CUMPLE PARCIAL' : 'NO CUMPLE'
    await EstadoHistorial.create({
      referidoId: ref.id,
      actorUserId: req.auth.id,
      desde: anterior,
      hacia: ref.estado,
      comentario: `Dictamen ADC: ${dictamenLabel}${comentario ? ` - ${comentario}` : ''}`,
    }, { transaction: t })

    await t.commit()

    notificarCambioEstado(ref, anterior, ref.estado, req.auth.id).catch(err =>
      console.error('[dictaminar] notificación FAIL:', err.message)
    )

    console.log(`[req:${req.id || '-'}] [dictaminar] OK ref=${id} dictamen=${dictamen}`)
    return res.json({ ok: true, id: ref.id, dictamen, estado: ref.estado })
  } catch (err) {
    await t.rollback()
    console.error(`[req:${req.id || '-'}] [dictaminar] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo registrar el dictamen' })
  }
}

// ──────────────────────────────────────────────────────────────
// Listar referidos asignados al ADC autenticado

async function listarParaADC(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasADC } = rolesFromReq(req)
  if (!hasADC) {
    return res.status(403).json({ error: 'Solo usuarios ADC' })
  }

  const page = Math.max(Number(req.query.page) || 1, 1)
  const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 200)
  const offset = (page - 1) * limit

  try {
    const Documento = getModel('Documento')
    const { rows, count } = await Referido.findAndCountAll({
      where: { asignadoADCUserId: req.auth.id },
      include: [
        { model: Usuario, as: 'creadoPor', attributes: ['id', 'username', 'correo'] },
        { model: Documento, as: 'adjuntos', attributes: ['id', 'nombre', 'ruta', 's3Key', 'mimetype', 'size'] },
      ],
      order: [['id', 'DESC']],
      limit,
      distinct: true,
      offset,
    })

    const dataWithCount = rows.map(r => {
      const plain = r.toJSON()
      plain.adjuntos_count = plain.adjuntos?.length || 0
      return plain
    })

    return res.json({ data: dataWithCount, page, limit, total: count })
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [listarParaADC] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo obtener los referidos asignados' })
  }
}

// ──────────────────────────────────────────────────────────────
// Listar usuarios con rol ADC (para el select de asignación)

async function listarADCUsuarios(req, res) {
  if (!req.auth?.id) return res.status(401).json({ error: 'No autenticado' })

  const { hasRRHH, hasADMIN, hasJefeRRHH } = rolesFromReq(req)
  if (!hasRRHH && !hasADMIN && !hasJefeRRHH) {
    return res.status(403).json({ error: 'Solo RRHH, JefeRRHH o ADMIN' })
  }

  try {
    const Rol = getModel('Rol')
    const rolADC = await Rol.findOne({ where: { nombre: 'ADC' } })
    if (!rolADC) return res.json([])

    const usuarios = await rolADC.getUsuarios({ attributes: ['id', 'username', 'correo'] })
    return res.json(usuarios)
  } catch (err) {
    console.error(`[req:${req.id || '-'}] [listarADCUsuarios] FAIL`, err)
    return res.status(500).json({ error: 'No se pudo obtener usuarios ADC' })
  }
}

module.exports = {
  create,
  list,
  getById,
  getStats,
  changeState,
  getHistorial,
  syncFromGmail,
  syncFromGmailManual,
  previewGmail,
  enviarADC,
  asignarADC,
  dictaminar,
  listarParaADC,
  listarADCUsuarios,
  // validators
  createValidators,
  listValidators,
  getValidators,
  changeValidators,
  syncGmailValidators,
  syncGmailManualValidators,
  previewGmailValidators,
  enviarADCValidators,
  asignarADCValidators,
  dictaminarValidators,
}
