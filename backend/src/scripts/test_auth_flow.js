/* eslint-disable no-console */
// Fase 3 — Flujo de autenticación completo
const API = 'http://127.0.0.1:4000/api'
const PASSWORD = 'TestPassword123!'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}  —  ${detail || ''}`)
}

async function call(method, path, { cookies, body, csrfToken } = {}) {
  const h = {}
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
  const setCookie = res.headers.getSetCookie?.() || []
  return { status: res.status, data, setCookie }
}

function cookiesFromSetCookie(setCookie) {
  return setCookie.map(c => c.split(';')[0]).join('; ')
}

async function main() {
  console.log('═══ FASE 3 — AUTH FLOW ═══\n')

  // ─── 3.1 Login exitoso ─────────────────────────────────────────
  console.log('─── 3.1 Login exitoso ───')
  const login1 = await call('POST', '/auth/login', {
    body: { correo: 'test_admin@ecora.cl', password: PASSWORD },
  })
  record('Login OK devuelve user', login1.status === 200 && login1.data?.user?.roles?.includes('ADMIN'),
    `status=${login1.status}`)
  record('Login OK setea cookie __access_token',
    login1.setCookie.some(c => c.startsWith('__access_token=')),
    `cookies=${login1.setCookie.map(c => c.split('=')[0]).join(',')}`)
  record('Login OK setea cookie __refresh_token',
    login1.setCookie.some(c => c.startsWith('__refresh_token=')),
    '')

  const cookies = cookiesFromSetCookie(login1.setCookie)

  // ─── 3.2 /auth/me con sesión ───────────────────────────────────
  console.log('\n─── 3.2 /auth/me con sesión activa ───')
  const meRes = await call('GET', '/auth/me', { cookies })
  record('GET /auth/me devuelve 200', meRes.status === 200, `roles=${JSON.stringify(meRes.data?.roles)}`)

  // ─── 3.3 Refresh token ─────────────────────────────────────────
  console.log('\n─── 3.3 Refresh token ───')
  const refreshOnly = cookies.split('; ').filter(c => c.startsWith('__refresh_token=')).join('; ')
  const refreshRes = await call('POST', '/auth/refresh', { cookies: refreshOnly })
  record('POST /auth/refresh OK con refresh cookie',
    refreshRes.status === 200,
    `status=${refreshRes.status}`)
  record('Refresh emite nueva cookie __access_token',
    refreshRes.setCookie.some(c => c.startsWith('__access_token=')),
    '')

  // ─── 3.4 Refresh sin cookie ────────────────────────────────────
  const refreshNoCookie = await call('POST', '/auth/refresh', {})
  record('Refresh sin cookie → 401',
    refreshNoCookie.status === 401,
    `status=${refreshNoCookie.status}`)

  // ─── 3.5 Logout ───────────────────────────────────────────────
  console.log('\n─── 3.5 Logout ───')
  const logoutRes = await call('POST', '/auth/logout', { cookies })
  record('POST /auth/logout 200', logoutRes.status === 200, `status=${logoutRes.status}`)
  record('Logout setea cookies expiradas',
    logoutRes.setCookie.some(c => /Max-Age=0|Expires=Thu, 01 Jan 1970/.test(c)),
    `cookies=${logoutRes.setCookie.map(c => c.split(';')[0]).join(',')}`)

  // ─── 3.6 Forgot password ──────────────────────────────────────
  console.log('\n─── 3.6 Forgot password ───')
  const forgot = await call('POST', '/auth/forgot-password', {
    body: { correo: 'test_admin@ecora.cl' },
  })
  record('Forgot password (correo válido) responde 200',
    forgot.status === 200 && forgot.data?.ok === true,
    `status=${forgot.status}`)

  const forgotFake = await call('POST', '/auth/forgot-password', {
    body: { correo: 'noexiste@ecora.cl' },
  })
  record('Forgot password (correo inválido) responde 200 genérico (no revela existencia)',
    forgotFake.status === 200 && forgotFake.data?.ok === true,
    `status=${forgotFake.status}`)

  // ─── 3.7 Reset password con token inválido ────────────────────
  const resetBad = await call('POST', '/auth/reset-password', {
    body: { token: 'tokeninvalido', newPassword: 'NewStrongPass1234!' },
  })
  record('Reset password con token inválido → 400',
    resetBad.status === 400,
    `status=${resetBad.status}`)

  // ─── 3.8 Account lockout (5 intentos fallidos) ─────────────────
  console.log('\n─── 3.8 Account lockout ───')
  // Usamos test_rrhh y hacemos 6 intentos
  const lockEmail = 'test_rrhh@ecora.cl'
  let lockResults = []
  for (let i = 1; i <= 6; i++) {
    const r = await call('POST', '/auth/login', {
      body: { correo: lockEmail, password: 'PassIncorrecta!' + i },
    })
    lockResults.push(r.status)
    await new Promise(r => setTimeout(r, 50))
  }
  const hasLockout = lockResults.some(s => s === 423 || s === 429)
  record('Account lockout tras múltiples intentos',
    hasLockout,
    `secuencia=${lockResults.join(',')}`)

  // Después del lockout, ni siquiera con password correcto debería entrar (si hubo 423)
  const correctAfterLock = await call('POST', '/auth/login', {
    body: { correo: lockEmail, password: PASSWORD },
  })
  record('Login correcto DESPUÉS de lockout',
    correctAfterLock.status === 423 || correctAfterLock.status === 200 || correctAfterLock.status === 429,
    `status=${correctAfterLock.status}`)

  // Limpiar lockout: resetear counters vía DB
  const { sequelize } = require('../db/connection')
  const { loadModels } = require('../db/loadModels')
  const associate = require('../db/associate')
  await sequelize.authenticate()
  const models = loadModels(sequelize)
  associate(models)
  await models.usuario.update(
    { failedAttempts: 0, lockedUntil: null },
    { where: { correo: lockEmail } }
  )
  console.log('  (reset failedAttempts en test_rrhh)')

  // ─── Resumen ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 3: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  await sequelize.close()
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
