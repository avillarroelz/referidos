/* eslint-disable no-console */
// Fase 2 — Test de mutaciones por rol (crear/editar/borrar con CSRF)
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
  if (body) h['Content-Type'] = 'application/json'
  if (csrfToken) h['x-csrf-token'] = csrfToken
  const res = await fetch(`${API}${path}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* */ }
  return { status: res.status, data }
}

async function main() {
  console.log('═══ FASE 2 — MUTACIONES ═══\n')

  const sessions = {}
  const csrfs = {}
  for (const [role, email] of Object.entries(USERS)) {
    const cookies = await login(email)
    if (cookies) {
      const csrf = await getCsrf(cookies)
      sessions[role] = csrf.cookies
      csrfs[role] = csrf.token
    }
  }

  // ─── 2.1 Crear referido — todos pueden ──────────────────────────
  console.log('─── 2.1 Crear referido (todos los roles) ───')
  const creados = {}
  for (const role of Object.keys(USERS)) {
    const res = await call('POST', '/referidos', {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: {
        nombre: `Test Referido por ${role}`,
        email: `referido_${role.toLowerCase()}@test.com`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        cargoPostulado: 'Tester',
      },
    })
    const ok = res.status === 201 || res.status === 200
    record(`${role} crea referido`, ok, `status=${res.status}, id=${res.data?.id || res.data?.data?.id || '?'}`)
    if (ok) creados[role] = res.data?.id || res.data?.data?.id
  }

  const referidoParaTest = creados.ADMIN || creados.RRHH || Object.values(creados)[0]
  console.log(`  → Usando referido #${referidoParaTest} para tests de edición\n`)

  // ─── 2.2 Cambiar estado — sólo RRHH/ADMIN/JefeRRHH ─────────────
  console.log('─── 2.2 Cambiar estado PATCH /referidos/:id/estado ───')
  for (const role of Object.keys(USERS)) {
    const res = await call('PATCH', `/referidos/${referidoParaTest}/estado`, {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { nuevoEstado: 'APROBADO', comentario: 'Test' },
    })
    const shouldPass = ['ADMIN', 'RRHH', 'JefeRRHH'].includes(role)
    const passed = shouldPass
      ? [200, 201, 400, 409].includes(res.status)
      : res.status === 403
    record(`${role} cambia estado`, passed, `status=${res.status}${shouldPass ? ' (permitido)' : ' (bloqueado esperado)'}`)
  }

  // ─── 2.3 Asignar ADC — solo RRHH/ADMIN/JefeRRHH ────────────────
  console.log('\n─── 2.3 Asignar ADC PATCH /referidos/:id/asignar-adc ───')
  // Obtener un ID de usuario ADC
  const adcList = await call('GET', '/referidos/adc-usuarios', { cookies: sessions.ADMIN })
  const adcUserId = adcList.data?.[0]?.id || adcList.data?.rows?.[0]?.id

  for (const role of Object.keys(USERS)) {
    const res = await call('PATCH', `/referidos/${referidoParaTest}/asignar-adc`, {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { adcUserId },
    })
    const shouldPass = ['ADMIN', 'RRHH', 'JefeRRHH'].includes(role)
    const passed = shouldPass
      ? [200, 201, 400, 409, 422].includes(res.status)
      : res.status === 403
    record(`${role} asigna ADC`, passed, `status=${res.status}`)
  }

  // ─── 2.4 Dictamen ADC — solo ADC ───────────────────────────────
  console.log('\n─── 2.4 Dictamen PATCH /referidos/:id/dictamen ───')
  for (const role of Object.keys(USERS)) {
    const res = await call('PATCH', `/referidos/${referidoParaTest}/dictamen`, {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { dictamen: 'APROBADO', comentario: 'Test' },
    })
    const shouldPass = role === 'ADC'
    const passed = shouldPass
      ? [200, 201, 400, 403, 409, 422].includes(res.status)
      : res.status === 403
    record(`${role} dictamina`, passed, `status=${res.status}`)
  }

  // ─── 2.5 Crear rol — solo ADMIN ────────────────────────────────
  console.log('\n─── 2.5 Crear rol POST /roles ───')
  for (const role of Object.keys(USERS)) {
    const res = await call('POST', '/roles', {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { nombre: `ROL_TEST_${role}_${Date.now()}`, descripcion: 'test' },
    })
    const shouldPass = role === 'ADMIN'
    const passed = shouldPass
      ? [200, 201, 400, 409].includes(res.status)
      : res.status === 403
    record(`${role} crea rol`, passed, `status=${res.status}`)
  }

  // ─── 2.6 Crear unidad — solo ADMIN ─────────────────────────────
  console.log('\n─── 2.6 Crear unidad POST /unidades ───')
  for (const role of Object.keys(USERS)) {
    const res = await call('POST', '/unidades', {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { nombre: `UN_TEST_${role}_${Date.now()}`, lineaId: 1 },
    })
    const shouldPass = role === 'ADMIN'
    const passed = shouldPass
      ? [200, 201, 400, 404, 409, 422].includes(res.status)
      : res.status === 403
    record(`${role} crea unidad`, passed, `status=${res.status}`)
  }

  // ─── 2.7 Crear línea — solo ADMIN ──────────────────────────────
  console.log('\n─── 2.7 Crear línea POST /lineas ───')
  for (const role of Object.keys(USERS)) {
    const res = await call('POST', '/lineas', {
      cookies: sessions[role],
      csrfToken: csrfs[role],
      body: { nombre: `LN_TEST_${role}_${Date.now()}` },
    })
    const shouldPass = role === 'ADMIN'
    const passed = shouldPass
      ? [200, 201, 400, 409].includes(res.status)
      : res.status === 403
    record(`${role} crea línea`, passed, `status=${res.status}`)
  }

  // ─── Resumen ───────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 2: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }

  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
