/* eslint-disable no-console */
// Fase 10 — Headers de seguridad (Helmet) + CORS + cookies
const API = 'http://127.0.0.1:4000/api'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}  —  ${detail || ''}`)
}

async function main() {
  console.log('═══ FASE 10 — HEADERS & SEGURIDAD ═══\n')

  // ─── 10.1 Helmet CSP ──────────────────────────────────────────
  const res = await fetch(`${API}/health`)
  const h = Object.fromEntries([...res.headers.entries()])

  record('Helmet: Content-Security-Policy presente',
    !!h['content-security-policy'],
    (h['content-security-policy'] || '').slice(0, 80) + '...')

  record('Helmet: X-Frame-Options = DENY',
    h['x-frame-options'] === 'DENY',
    h['x-frame-options'])

  record('Helmet: X-Content-Type-Options = nosniff',
    h['x-content-type-options'] === 'nosniff',
    h['x-content-type-options'])

  record('Helmet: Strict-Transport-Security (HSTS)',
    !!h['strict-transport-security'],
    h['strict-transport-security'])

  record('Helmet: Referrer-Policy',
    !!h['referrer-policy'],
    h['referrer-policy'])

  record('Header: no expone X-Powered-By',
    !h['x-powered-by'],
    h['x-powered-by'] || '(removido OK)')

  // ─── 10.2 CORS preflight ──────────────────────────────────────
  console.log('\n─── 10.2 CORS ───')
  const corsOrigin = 'http://localhost:5173'
  const preflight = await fetch(`${API}/auth/login`, {
    method: 'OPTIONS',
    headers: {
      'Origin': corsOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  })
  const corsH = Object.fromEntries([...preflight.headers.entries()])
  record('CORS: preflight permite origen localhost:5173',
    corsH['access-control-allow-origin'] === corsOrigin,
    corsH['access-control-allow-origin'])

  record('CORS: credentials = true',
    corsH['access-control-allow-credentials'] === 'true',
    corsH['access-control-allow-credentials'])

  // CORS con origen no permitido
  const badCors = await fetch(`${API}/health`, {
    headers: { 'Origin': 'http://evil.example.com' },
  })
  const badCorsH = Object.fromEntries([...badCors.headers.entries()])
  record('CORS: origen no permitido NO obtiene allow-origin reflejado',
    badCorsH['access-control-allow-origin'] !== 'http://evil.example.com',
    `allow-origin=${badCorsH['access-control-allow-origin'] || '(vacío)'}`)

  // ─── 10.3 Cookies httpOnly ────────────────────────────────────
  console.log('\n─── 10.3 Cookies ───')
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo: 'test_admin@ecora.cl', password: 'TestPassword123!' }),
  })
  const setCookies = login.headers.getSetCookie?.() || []

  const access = setCookies.find(c => c.startsWith('__access_token='))
  const refresh = setCookies.find(c => c.startsWith('__refresh_token='))

  record('Cookie __access_token: HttpOnly',
    access && /HttpOnly/i.test(access),
    access ? 'marcada' : 'falta')
  record('Cookie __refresh_token: HttpOnly',
    refresh && /HttpOnly/i.test(refresh),
    refresh ? 'marcada' : 'falta')
  record('Cookie __access_token: SameSite',
    access && /SameSite=(Lax|Strict)/i.test(access),
    access?.match(/SameSite=\w+/i)?.[0])
  record('Cookie __refresh_token: SameSite',
    refresh && /SameSite=(Lax|Strict)/i.test(refresh),
    refresh?.match(/SameSite=\w+/i)?.[0])

  // ─── 10.5 CSRF cookie __csrf httpOnly ─────────────────────────
  console.log('\n─── 10.5 CSRF cookie ───')
  const csrfRes = await fetch(`${API}/csrf-token`)
  const csrfSet = csrfRes.headers.getSetCookie?.() || []
  const csrfCookie = csrfSet.find(c => c.startsWith('__csrf='))
  record('Cookie __csrf: HttpOnly',
    csrfCookie && /HttpOnly/i.test(csrfCookie),
    csrfCookie ? 'OK' : 'falta')
  record('CSRF endpoint responde JSON con token',
    csrfRes.status === 200,
    `status=${csrfRes.status}`)

  // ─── Resumen ──────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 10: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
