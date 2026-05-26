/* eslint-disable no-console */
// Test de accesibilidad por rol — ejecuta contra la API local usando fetch nativo
const API = 'http://127.0.0.1:4000/api'
const PASSWORD = 'TestPassword123!'

const USERS = {
  ADMIN:      'test_admin@ecora.cl',
  RRHH:       'test_rrhh@ecora.cl',
  JefeRRHH:   'test_jeferrhh@ecora.cl',
  TRABAJADOR: 'test_trabajador@ecora.cl',
  ADC:        'test_adc@ecora.cl',
}

// Matriz de endpoints: cada uno define los roles esperados (200 = OK) vs los demás (403)
const ENDPOINTS = [
  // Notificaciones (todos autenticados)
  { method: 'GET', url: '/notificaciones',         allow: ['ADMIN','RRHH','JefeRRHH','TRABAJADOR','ADC'] },
  { method: 'GET', url: '/notificaciones/count',   allow: ['ADMIN','RRHH','JefeRRHH','TRABAJADOR','ADC'] },

  // Referidos - listado GLOBAL solo RRHH/ADMIN/JefeRRHH (otros necesitan ?mine=1)
  { method: 'GET', url: '/referidos',              allow: ['ADMIN','RRHH','JefeRRHH'] },
  { method: 'GET', url: '/referidos?mine=1',       allow: ['ADMIN','RRHH','JefeRRHH','TRABAJADOR','ADC'] },
  { method: 'GET', url: '/referidos/stats',        allow: ['ADMIN','RRHH','JefeRRHH','TRABAJADOR','ADC'] },
  { method: 'GET', url: '/referidos/adc-usuarios', allow: ['ADMIN','RRHH','JefeRRHH'] },
  { method: 'GET', url: '/referidos/mis-asignados', allow: ['ADC'] },

  // KPIs (ADMIN, RRHH)
  { method: 'GET', url: '/kpis/overview',     allow: ['ADMIN','RRHH','JefeRRHH'] },
  // Verifica scope restringido: sin mine=1, roles bajos NO deben listar
  { method: 'GET', url: '/kpis/conversion-rate', allow: ['ADMIN','RRHH','JefeRRHH'] },
  { method: 'GET', url: '/kpis/funnel',       allow: ['ADMIN','RRHH','JefeRRHH'] },
  { method: 'GET', url: '/kpis/sla',          allow: ['ADMIN','RRHH','JefeRRHH'] },

  // Roles
  { method: 'GET', url: '/roles',           allow: ['ADMIN','RRHH'] },
  { method: 'GET', url: '/roles/usuarios',  allow: ['ADMIN','RRHH'] },

  // Lineas / Unidades (lectura ADMIN+RRHH)
  { method: 'GET', url: '/lineas',          allow: ['ADMIN','RRHH'] },
  { method: 'GET', url: '/unidades',        allow: ['ADMIN','RRHH'] },

  // Personas
  { method: 'GET', url: '/personas',        allow: ['ADMIN','RRHH'] },

  // Gmail (ADMIN, RRHH)
  { method: 'GET', url: '/gmail/status',    allow: ['ADMIN','RRHH'] },
]

async function login(correo) {
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ correo, password: PASSWORD }),
    })
    if (res.status !== 200) {
      const txt = await res.text()
      throw new Error(`Login falló para ${correo} (${res.status}): ${txt}`)
    }
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : []
    const cookies = setCookie.map(c => c.split(';')[0]).join('; ')
    return cookies
  } catch (e) {
    throw new Error(`[${correo}] ${e.message} | cause: ${e.cause?.message || 'n/a'}`)
  }
}

async function call(method, url, cookies) {
  try {
    const res = await fetch(`${API}${url}`, {
      method,
      headers: { Cookie: cookies },
      signal: AbortSignal.timeout(8000),
    })
    let data = null
    try { data = await res.json() } catch { /* no-json */ }
    return { status: res.status, data }
  } catch (e) {
    return { status: 0, error: e.message }
  }
}

function verdict(actual, allow, role) {
  const shouldAllow = allow.includes(role)
  if (shouldAllow) {
    // 200/201 = OK, 404 puede ser OK si recurso no existe pero tiene acceso, 500 = bug
    if (actual === 200) return { ok: true, mark: 'OK(200)' }
    if (actual === 404) return { ok: true, mark: 'OK(404 vacío)' }
    if (actual === 400) return { ok: true, mark: 'OK(400 validación)' }
    if (actual === 403) return { ok: false, mark: 'FALLO: 403 cuando debería permitir' }
    if (actual === 500) return { ok: false, mark: '❌ BUG 500' }
    return { ok: false, mark: `??? ${actual}` }
  } else {
    if (actual === 403) return { ok: true, mark: 'OK(403 bloqueado)' }
    if (actual === 401) return { ok: true, mark: 'OK(401)' }
    if (actual === 200) return { ok: false, mark: '⚠ LEAK: acceso indebido' }
    if (actual === 500) return { ok: false, mark: '❌ BUG 500' }
    return { ok: false, mark: `??? ${actual}` }
  }
}

async function main() {
  console.log('Iniciando tests de acceso por rol...\n')

  const sessions = {}
  for (const [role, email] of Object.entries(USERS)) {
    try {
      const cookies = await login(email)
      sessions[role] = cookies
      console.log(`  ✓ Login OK: ${role}`)
    } catch (e) {
      console.log(`  ✗ Login FALLO: ${role} — ${e.message}`)
    }
  }

  console.log('\n─────────────────────────────────────────────────────────────────────')
  console.log('Matriz Rol x Endpoint (OK = comportamiento esperado)')
  console.log('─────────────────────────────────────────────────────────────────────\n')

  const results = []
  const bugs = []

  for (const ep of ENDPOINTS) {
    console.log(`${ep.method} ${ep.url}  [allow: ${ep.allow.join(',')}]`)
    for (const role of Object.keys(USERS)) {
      if (!sessions[role]) continue
      const res = await call(ep.method, ep.url, sessions[role])
      const v = verdict(res.status, ep.allow, role)
      const icon = v.ok ? '✓' : '✗'
      console.log(`    ${icon} ${role.padEnd(12)} → ${v.mark}`)
      results.push({ endpoint: `${ep.method} ${ep.url}`, role, status: res.status, verdict: v.mark, ok: v.ok })
      if (!v.ok) bugs.push({ endpoint: `${ep.method} ${ep.url}`, role, status: res.status, issue: v.mark })
    }
    console.log()
  }

  console.log('═════════════════════════════════════════════════════════════════════')
  console.log('RESUMEN')
  console.log('═════════════════════════════════════════════════════════════════════')
  const total = results.length
  const pass = results.filter(r => r.ok).length
  console.log(`Total casos: ${total} — OK: ${pass} — FALLOS: ${total - pass}`)

  if (bugs.length) {
    console.log('\nFALLOS DETECTADOS:')
    bugs.forEach(b => console.log(`  • ${b.endpoint} con ${b.role} → ${b.issue}`))
  } else {
    console.log('\n✅ Ningún fallo detectado.')
  }

  process.exit(bugs.length ? 1 : 0)
}

main().catch(e => {
  console.error('Error fatal:', e)
  process.exit(2)
})
