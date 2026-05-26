/* eslint-disable no-console */
// Fase 5 — Rate limiters
const API = 'http://127.0.0.1:4000/api'

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}  —  ${detail || ''}`)
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status }
}

async function main() {
  console.log('═══ FASE 5 — RATE LIMITERS ═══\n')

  // ─── 5.1 authLoginLimiter: 10 intentos / 15min por EMAIL ───────
  console.log('─── 5.1 Login limiter (10/15min por correo) ───')
  // Usamos un correo dedicado para no bloquear test_rrhh
  const dedicatedEmail = 'ratelimit_test@ecora.cl'
  const codes = []
  for (let i = 1; i <= 12; i++) {
    const r = await post('/auth/login', { correo: dedicatedEmail, password: 'wrong' + i })
    codes.push(r.status)
    if (r.status === 429) break
    await new Promise(r => setTimeout(r, 30))
  }
  record('Login limiter bloquea eventualmente con 429',
    codes.includes(429),
    `secuencia=${codes.join(',')}`)

  // ─── 5.2 authRegisterLimiter: 5 / 60min ────────────────────────
  console.log('\n─── 5.2 Register limiter (5/60min) ───')
  const regCodes = []
  for (let i = 1; i <= 7; i++) {
    const r = await post('/auth/register', {
      username: `rltest_${Date.now()}_${i}`,
      correo: `rltest${Date.now()}_${i}@test.com`,
      password: 'PasswordValid1234!',
    })
    regCodes.push(r.status)
    if (r.status === 429) break
    await new Promise(r => setTimeout(r, 30))
  }
  record('Register limiter eventualmente 429',
    regCodes.includes(429),
    `secuencia=${regCodes.join(',')}`)

  // ─── 5.3 publicFormLimiter: 5 / 15min ──────────────────────────
  console.log('\n─── 5.3 Public form limiter (5/15min) ───')
  const publicCodes = []
  for (let i = 1; i <= 7; i++) {
    const r = await post('/public/referidos', {
      nombre: `PubTest${i}`,
      email: `pub${i}@test.com`,
    })
    publicCodes.push(r.status)
    if (r.status === 429) break
    await new Promise(r => setTimeout(r, 30))
  }
  record('Public form limiter eventualmente 429',
    publicCodes.includes(429),
    `secuencia=${publicCodes.join(',')}`)

  // ─── 5.4 Global limiter skipea /auth/* ─────────────────────────
  console.log('\n─── 5.4 Global limiter skipea auth (no debe aplicar) ───')
  // El limiter global tiene max=1000/15min, no llegaremos ahí. Verificamos que el endpoint de health no tenga 429
  const healthCodes = []
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${API}/health`)
    healthCodes.push(r.status)
  }
  record('20 calls a /health — ninguno 429',
    !healthCodes.includes(429),
    `status únicos=${[...new Set(healthCodes)].join(',')}`)

  // ─── Resumen ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 5: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
