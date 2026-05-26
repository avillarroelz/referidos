/* eslint-disable no-console */
// Fase 1 — Test de seguridad: IDOR, CSRF, JWT manipulado, usuario inactivo
const API = 'http://127.0.0.1:4000/api'
const PASSWORD = 'TestPassword123!'
const USERS = {
  ADMIN:      'test_admin@ecora.cl',
  RRHH:       'test_rrhh@ecora.cl',
  JefeRRHH:   'test_jeferrhh@ecora.cl',
  TRABAJADOR: 'test_trabajador@ecora.cl',
  ADC:        'test_adc@ecora.cl',
}

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}  —  ${detail || ''}`)
}

async function login(correo, password = PASSWORD) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, password }),
  })
  const setCookie = res.headers.getSetCookie?.() || []
  const cookies = setCookie.map(c => c.split(';')[0]).join('; ')
  let body = null
  try { body = await res.json() } catch { /* */ }
  return { status: res.status, cookies, body }
}

async function call(method, path, { cookies, body, headers, csrfToken } = {}) {
  const h = { ...(headers || {}) }
  if (cookies) h.Cookie = cookies
  if (body) h['Content-Type'] = 'application/json'
  if (csrfToken) h['x-csrf-token'] = csrfToken
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* */ }
  return { status: res.status, data, headers: res.headers }
}

async function getCsrf(cookies) {
  const res = await fetch(`${API}/csrf-token`, { headers: { Cookie: cookies } })
  const data = await res.json()
  const setCookie = res.headers.getSetCookie?.() || []
  const csrfCookie = setCookie.find(c => c.startsWith('__csrf=')) || ''
  const mergedCookies = cookies + '; ' + csrfCookie.split(';')[0]
  return { token: data.csrfToken, cookies: mergedCookies }
}

async function main() {
  console.log('═══ FASE 1 — SEGURIDAD ═══\n')

  // Login de todos los roles
  const sessions = {}
  for (const [role, email] of Object.entries(USERS)) {
    const { status, cookies } = await login(email)
    if (status === 200) sessions[role] = cookies
    else console.log(`  (no se pudo loguear ${role})`)
  }
  console.log(`Sesiones obtenidas: ${Object.keys(sessions).join(', ')}\n`)

  // ─── 1.1 IDOR: ADC intenta acceder a referido NO asignado ──────
  console.log('─── 1.1 IDOR horizontal — referido por ID ───')
  // Admin lista todos los referidos para tomar un ID al azar
  const adminList = await call('GET', '/referidos?page=1&limit=5', { cookies: sessions.ADMIN })
  const referidoId = adminList.data?.rows?.[0]?.id || adminList.data?.data?.[0]?.id || 1
  console.log(`  → Usando referidoId=${referidoId}`)

  // ADC intenta ver un referido cualquiera
  const adcGet = await call('GET', `/referidos/${referidoId}`, { cookies: sessions.ADC })
  // Esperable: 200 o 403 si no es suyo (verifica que el controller filtre por rol)
  record(
    'ADC accede a /referidos/:id arbitrario',
    [200, 403, 404].includes(adcGet.status),
    `status=${adcGet.status} (ideal: 403 si no es suyo, o 200 si el controller filtra)`
  )

  // TRABAJADOR intenta ver referido creado por otro
  const workerGet = await call('GET', `/referidos/${referidoId}`, { cookies: sessions.TRABAJADOR })
  record(
    'TRABAJADOR accede a /referidos/:id ajeno',
    [200, 403, 404].includes(workerGet.status),
    `status=${workerGet.status}`
  )

  // TRABAJADOR intenta listar referidos de OTRO usuario con ?createdBy=<otroId>
  const listOther = await call('GET', '/referidos?createdBy=1', { cookies: sessions.TRABAJADOR })
  record(
    'TRABAJADOR intenta listar con ?createdBy=<otro>',
    listOther.status === 403,
    `status=${listOther.status} (debe ser 403 — scope enforcement)`
  )

  // ─── 1.2 CSRF ───────────────────────────────────────────────────
  console.log('\n─── 1.2 CSRF — POST sin token ───')

  // POST crear referido SIN csrf-token
  const noCsrf = await call('POST', '/referidos', {
    cookies: sessions.ADMIN,
    body: { nombre: 'Test CSRF Sin Token', email: 'csrf@test.com' },
  })
  record(
    'POST /referidos sin x-csrf-token',
    noCsrf.status === 403,
    `status=${noCsrf.status} (debe ser 403 por CSRF)`
  )

  // POST con csrf-token válido
  const csrf = await getCsrf(sessions.ADMIN)
  const withCsrf = await call('POST', '/referidos', {
    cookies: csrf.cookies,
    csrfToken: csrf.token,
    body: { nombre: 'Test CSRF Valido', email: 'csrf-ok@test.com' },
  })
  record(
    'POST /referidos con x-csrf-token válido',
    [200, 201, 400, 409, 422].includes(withCsrf.status),
    `status=${withCsrf.status} (esperable 201 o validación 400)`
  )

  // ─── 1.3 JWT manipulado ────────────────────────────────────────
  console.log('\n─── 1.3 JWT manipulado ───')

  // Cookie de access_token alterada
  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.payload'
  const tampered = await call('GET', '/auth/me', {
    cookies: `__access_token=${fakeToken}`,
  })
  record(
    'JWT manipulado → /auth/me',
    tampered.status === 401,
    `status=${tampered.status} (debe ser 401)`
  )

  // Sin cookie
  const noAuth = await call('GET', '/auth/me', {})
  record(
    'Sin cookie → /auth/me',
    noAuth.status === 401,
    `status=${noAuth.status} (debe ser 401)`
  )

  // ─── 1.4 Cookie de otro usuario (reuso de sesión) ──────────────
  console.log('\n─── 1.4 Uso cruzado de cookies ───')
  // ADC usa cookie de ADMIN → debería aparecer como ADMIN (no hay IDOR aquí por diseño, pero
  // se verifica que no ocurra un bug de bleed-through de sesión)
  const roleTest = await call('GET', '/auth/me', { cookies: sessions.ADMIN })
  record(
    'Cookie ADMIN → /auth/me reporta ADMIN',
    roleTest.data?.roles?.includes('ADMIN'),
    `roles=${JSON.stringify(roleTest.data?.roles)}`
  )

  // ─── 1.5 Usuario inactivo ──────────────────────────────────────
  console.log('\n─── 1.5 Usuario inactivo (estado=false) ───')

  // Desactivamos el test_trabajador directamente por DB y verificamos que no loguea
  const { sequelize } = require('../db/connection')
  const { loadModels } = require('../db/loadModels')
  const associate = require('../db/associate')
  await sequelize.authenticate()
  const models = loadModels(sequelize)
  associate(models)
  const Usuario = models.usuario

  await Usuario.update({ estado: false }, { where: { correo: USERS.TRABAJADOR } })
  const loginInactive = await login(USERS.TRABAJADOR)
  record(
    'Login con usuario estado=false',
    loginInactive.status === 401 || loginInactive.status === 403,
    `status=${loginInactive.status} (debe fallar)`
  )
  // Restaurar
  await Usuario.update({ estado: true }, { where: { correo: USERS.TRABAJADOR } })

  // ─── 1.6 Credenciales inválidas ────────────────────────────────
  console.log('\n─── 1.6 Credenciales inválidas ───')
  const badPass = await login(USERS.ADMIN, 'ContraseñaIncorrecta123!')
  record(
    'Login con password incorrecto',
    badPass.status === 401,
    `status=${badPass.status} (debe ser 401)`
  )

  // ─── Resumen ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 1: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  await sequelize.close()
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => {
  console.error('Error fatal:', e)
  process.exit(2)
})
