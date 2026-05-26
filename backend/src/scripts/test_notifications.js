/* eslint-disable no-console */
// Fase 7 — Notificaciones al cambiar estado / asignar ADC
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
  if (body) h['Content-Type'] = 'application/json'
  if (csrfToken) h['x-csrf-token'] = csrfToken
  const res = await fetch(`${API}${path}`, {
    method, headers: h,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* */ }
  return { status: res.status, data }
}

async function main() {
  console.log('═══ FASE 7 — NOTIFICACIONES ═══\n')

  // Sesiones
  const trabajador = await login('test_trabajador@ecora.cl')
  const admin = await login('test_admin@ecora.cl')
  const adc = await login('test_adc@ecora.cl')

  const trabajadorCsrf = await getCsrf(trabajador)
  const adminCsrf = await getCsrf(admin)
  const adcCsrf = await getCsrf(adc)

  // ─── 7.1 TRABAJADOR crea un referido propio ──────────────────
  console.log('─── 7.1 Setup: TRABAJADOR crea referido ───')
  const creado = await call('POST', '/referidos', {
    cookies: trabajadorCsrf.cookies, csrfToken: trabajadorCsrf.token,
    body: {
      nombre: `Notif Test ${Date.now()}`,
      email: `notiftest_${Date.now()}@test.com`,
      rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
    },
  })
  const referidoId = creado.data?.id || creado.data?.data?.id
  record('TRABAJADOR crea referido', !!referidoId, `id=${referidoId}, status=${creado.status}`)
  if (!referidoId) { process.exit(1) }

  // ─── 7.2 Contar notificaciones antes ──────────────────────────
  const beforeTrabajador = await call('GET', '/notificaciones/count', { cookies: trabajador })
  const beforeAdc = await call('GET', '/notificaciones/count', { cookies: adc })
  console.log(`  TRABAJADOR count antes: ${beforeTrabajador.data?.count}`)
  console.log(`  ADC count antes: ${beforeAdc.data?.count}`)

  // ─── 7.3 ADMIN cambia estado del referido ────────────────────
  console.log('\n─── 7.3 ADMIN cambia estado → EN_REVISION ───')
  const cambio = await call('PATCH', `/referidos/${referidoId}/estado`, {
    cookies: adminCsrf.cookies, csrfToken: adminCsrf.token,
    body: { nuevoEstado: 'EN_REVISION', comentario: 'Test de notificación' },
  })
  record('Cambio de estado OK', [200, 201].includes(cambio.status), `status=${cambio.status}`)

  // Esperar un segundo para que se procese la notificación asíncrona
  await new Promise(r => setTimeout(r, 500))

  // ─── 7.4 TRABAJADOR recibe notificación ──────────────────────
  const afterTrabajador = await call('GET', '/notificaciones/count', { cookies: trabajador })
  console.log(`  TRABAJADOR count después: ${afterTrabajador.data?.count}`)
  record('TRABAJADOR (creador) recibe notificación de cambio de estado',
    (afterTrabajador.data?.count || 0) > (beforeTrabajador.data?.count || 0),
    `${beforeTrabajador.data?.count} → ${afterTrabajador.data?.count}`)

  // ─── 7.5 Listar la notificación nueva ────────────────────────
  const listNotif = await call('GET', '/notificaciones?page=1&limit=5', { cookies: trabajador })
  const hayNotifDelReferido = listNotif.data?.data?.some?.(n => n.referidoId === referidoId)
  record('La notificación referencia el referidoId correcto',
    !!hayNotifDelReferido,
    `total=${listNotif.data?.total}`)

  // ─── 7.6 Asignar ADC ─ notifica al ADC ───────────────────────
  console.log('\n─── 7.6 Asignar ADC ───')
  // Obtener ID del test_adc específicamente (nuestra sesión)
  const adcMe = await call('GET', '/auth/me', { cookies: adc })
  const adcId = adcMe.data?.id

  const beforeAdcAsign = await call('GET', '/notificaciones/count', { cookies: adc })

  const asignar = await call('PATCH', `/referidos/${referidoId}/asignar-adc`, {
    cookies: adminCsrf.cookies, csrfToken: adminCsrf.token,
    body: { adcUserId: adcId },
  })
  record('Asignar ADC OK', [200, 201].includes(asignar.status), `status=${asignar.status}, adcId=${adcId}`)

  await new Promise(r => setTimeout(r, 500))

  const afterAdcAsign = await call('GET', '/notificaciones/count', { cookies: adc })
  record('ADC recibe notificación cuando es asignado',
    (afterAdcAsign.data?.count || 0) > (beforeAdcAsign.data?.count || 0),
    `${beforeAdcAsign.data?.count} → ${afterAdcAsign.data?.count}`)

  // ─── 7.7 Marcar una como leída ───────────────────────────────
  console.log('\n─── 7.7 Marcar notificación como leída ───')
  const notifList = await call('GET', '/notificaciones?page=1&limit=1', { cookies: trabajador })
  const notifId = notifList.data?.data?.[0]?.id
  if (notifId) {
    const countAntes = (await call('GET', '/notificaciones/count', { cookies: trabajador })).data?.count
    const mark = await call('PATCH', `/notificaciones/${notifId}`, {
      cookies: trabajadorCsrf.cookies, csrfToken: trabajadorCsrf.token,
    })
    record('PATCH /notificaciones/:id OK', mark.status === 200, `status=${mark.status}`)

    const countDespues = (await call('GET', '/notificaciones/count', { cookies: trabajador })).data?.count
    record('Contador de no leídas decrementa',
      countDespues < countAntes,
      `${countAntes} → ${countDespues}`)
  } else {
    record('No hay notificaciones para marcar', false, 'skip')
  }

  // ─── Resumen ─────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════')
  const pass = results.filter(r => r.ok).length
  console.log(`RESUMEN FASE 7: ${pass}/${results.length} casos OK`)
  if (pass < results.length) {
    console.log('\nFALLOS:')
    results.filter(r => !r.ok).forEach(r => console.log(`  • ${r.name} — ${r.detail}`))
  }
  process.exit(pass === results.length ? 0 : 1)
}

main().catch(e => { console.error('Error fatal:', e); process.exit(2) })
