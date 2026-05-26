/* eslint-disable no-console */
// Fase 4 — Validaciones de entrada
const API = 'http://127.0.0.1:4000/api'
const PASSWORD = 'TestPassword123!'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}  —  ${detail || ''}`)
}

async function login(correo) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, password: PASSWORD }),
  })
  const setCookie = res.headers.getSetCookie?.() || []
  return setCookie.map(c => c.split(';')[0]).join('; ')
}

async function getCsrf(cookies) {
  const res = await fetch(`${API}/csrf-token`, { headers: { Cookie: cookies } })
  const data = await res.json()
  const setCookie = res.headers.getSetCookie?.() || []
  const csrfCookie = setCookie.find(c => c.startsWith('__csrf=')) || ''
  return { token: data.csrfToken, cookies: cookies + (csrfCookie ? '; ' + csrfCookie.split(';')[0] : '') }
}

async function call(method, path, { cookies, body, csrfToken } = {}) {
  const h = {}
  if (cookies) h.Cookie = cookies
  if (body !== undefined) h['Content-Type'] = 'application/json'
  if (csrfToken) h['x-csrf-token'] = csrfToken
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* */ }
  return { status: res.status, data }
}

async function main() {
  console.log('═══ FASE 4 — VALIDACIONES ═══\n')

  const cookies = await login('test_admin@ecora.cl')
  const csrf = await getCsrf(cookies)

  // ─── 4.1 Registro con email inválido ───────────────────────────
  // Nota: aceptamos 429 como OK también (rate limiter puede activarse si se corre junto a test_ratelimits)
  console.log('─── 4.1 Register — validaciones ───')
  const r1 = await call('POST', '/auth/register', {
    body: { username: 'x', correo: 'notanemail', password: 'short' },
  })
  record('Register email inválido → 400 (o 429 si limiter activo)',
    [400, 429].includes(r1.status), `status=${r1.status}`)

  const r2 = await call('POST', '/auth/register', {
    body: { username: 'validuser', correo: 'valid@test.com', password: 'short' },
  })
  record('Register password corta → 400 (o 429)',
    [400, 429].includes(r2.status), `status=${r2.status}`)

  // ─── 4.2 Login sin correo ──────────────────────────────────────
  console.log('\n─── 4.2 Login — validaciones ───')
  const l1 = await call('POST', '/auth/login', { body: { password: PASSWORD } })
  record('Login sin correo → 400', l1.status === 400 || l1.status === 401, `status=${l1.status}`)

  const l2 = await call('POST', '/auth/login', { body: { correo: 'test_admin@ecora.cl' } })
  record('Login sin password → 400/401', l2.status === 400 || l2.status === 401, `status=${l2.status}`)

  // ─── 4.3 Crear referido con campos faltantes ──────────────────
  console.log('\n─── 4.3 Referido — validaciones ───')
  const c1 = await call('POST', '/referidos', {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: {},
  })
  record('Crear referido sin nombre → 400', c1.status === 400, `status=${c1.status}`)

  const c2 = await call('POST', '/referidos', {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: { nombre: 'Test', email: 'mal-formato' },
  })
  record('Crear referido con email inválido → 400', c2.status === 400, `status=${c2.status}`)

  // ─── 4.4 XSS en inputs ────────────────────────────────────────
  console.log('\n─── 4.4 XSS — payload peligroso ───')
  const xssPayload = '<script>alert(\'xss\')</script>'
  const xss1 = await call('POST', '/referidos', {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: { nombre: xssPayload, email: 'xss@test.com' },
  })
  // Debe aceptar pero NO ejecutar — verificamos que lo persista como string literal
  if (xss1.status === 201) {
    const id = xss1.data?.id || xss1.data?.data?.id
    const getR = await call('GET', `/referidos/${id}`, { cookies: csrf.cookies })
    const stored = getR.data?.nombre || getR.data?.data?.nombre || ''
    record('XSS payload se persiste como literal (no ejecutado)',
      stored.toLowerCase().includes('<script>') || stored === xssPayload,
      `stored="${stored.slice(0, 40)}..." (escapado por React al renderizar)`)
  } else {
    record('XSS payload rechazado por validación', xss1.status === 400, `status=${xss1.status}`)
  }

  // ─── 4.5 Estado inválido ──────────────────────────────────────
  console.log('\n─── 4.5 Cambio de estado — validaciones ───')
  const adminList = await call('GET', '/referidos?page=1&limit=1', { cookies: csrf.cookies })
  const someId = adminList.data?.rows?.[0]?.id || adminList.data?.data?.[0]?.id || 1
  const badEstado = await call('PATCH', `/referidos/${someId}/estado`, {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: { nuevoEstado: 'ESTADO_INEXISTENTE' },
  })
  record('Estado inválido → 400', badEstado.status === 400, `status=${badEstado.status}`)

  // ─── 4.6 ID inválido ───────────────────────────────────────────
  const badId = await call('GET', '/referidos/noesunnumero', { cookies: csrf.cookies })
  record('GET /referidos/:id con id no numérico → 400', badId.status === 400, `status=${badId.status}`)

  const negativeId = await call('GET', '/referidos/-1', { cookies: csrf.cookies })
  record('GET /referidos/:id con id negativo → 400', negativeId.status === 400, `status=${negativeId.status}`)

  const nonExistent = await call('GET', '/referidos/999999999', { cookies: csrf.cookies })
  record('GET /referidos/:id inexistente → 404', nonExistent.status === 404, `status=${nonExistent.status}`)

  // ─── 4.7 Payload excesivo (>2MB) ──────────────────────────────
  console.log('\n─── 4.7 Payload excesivo ───')
  const huge = 'X'.repeat(3 * 1024 * 1024) // 3MB
  const bigBody = await call('POST', '/referidos', {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: { nombre: 'Test', observaciones: huge },
  })
  record('Payload >2MB → 413',
    bigBody.status === 413 || bigBody.status === 400,
    `status=${bigBody.status}`)

  // ─── 4.8 JSON malformado ──────────────────────────────────────
  console.log('\n─── 4.8 JSON malformado ───')
  const badJson = await call('POST', '/referidos', {
    cookies: csrf.cookies, csrfToken: csrf.token,
    body: '{ "nombre": "test", invalid json',
  })
  record('JSON malformado → 400', badJson.status === 400, `status=${badJson.status}`)

  // ─── Resumen ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 4: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
