# Ecora Security Standards — Referencia para Claude/IA

> Documento optimizado para que Claude Opus aplique estos estándares de seguridad OWASP a cualquier proyecto Node.js/Express + React. Seguir en orden de prioridad.

## Stack esperado
- Backend: Express.js + Sequelize (PostgreSQL) + JWT
- Frontend: React + Vite + Axios
- Almacenamiento: AWS S3 (opcional)
- Email: Nodemailer

---

## 1. Dependencias de seguridad requeridas

```bash
npm install helmet cors cookie-parser csrf-csrf express-rate-limit express-validator bcryptjs jsonwebtoken winston winston-daily-rotate-file
```

---

## 2. JWT — Tokens en httpOnly cookies

### Backend: config.js
```javascript
jwt: {
  secret: (() => {
    const s = process.env.JWT_SECRET
    if (!s && isProd) { console.error('JWT_SECRET no configurado'); process.exit(1) }
    return s || 'devsecret-change-me'
  })(),
  expiresIn: '20m',
  refreshSecret: /* mismo patrón, DIFERENTE secret */,
  refreshExpiresIn: '7d',
  algorithm: 'HS256'
}
```
- Generar secrets con: `openssl rand -hex 32`
- Access y Refresh secrets DEBEN ser diferentes
- Especificar algorithm en sign() y verify()

### Backend: auth.controller.js — Cookie helpers
```javascript
const COOKIE_OPTS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'strict' : 'lax',
  path: '/',
}
// Login: setAuthCookies(res, accessToken, refreshToken)
// Logout: clearAuthCookies(res)
// Refresh: leer req.cookies.__refresh_token, setear nuevo __access_token
```

### Backend: middleware/auth.js — Leer token
```
Prioridad: cookie.__access_token > Authorization header > query string
```

### Frontend: SIN tokens en localStorage
- `withCredentials: true` en axios
- Sin Authorization header manual
- Refresh: POST /auth/refresh (cookie se envía automáticamente)
- Storage solo para datos del usuario (no sensibles)

---

## 3. Password — Requisitos y hashing

```javascript
// Validación (express-validator)
body('password')
  .isLength({ min: 12 })
  .matches(/[A-Z]/)  // mayúscula
  .matches(/[a-z]/)  // minúscula
  .matches(/[0-9]/)  // número

// Hashing
bcrypt.hash(plain, 12)  // salt rounds >= 12
```

Frontend: validar las mismas reglas antes de enviar.

---

## 4. Account Lockout

```javascript
// Modelo Usuario: agregar campos
failedAttempts: { type: INTEGER, defaultValue: 0 }
lockedUntil: { type: DATE, allowNull: true }

// Login:
// 1. Si lockedUntil > now → HTTP 423 con retryAfterSeconds
// 2. Si password incorrecto → failedAttempts++
// 3. Si failedAttempts >= 5 → lockedUntil = now + 30min
// 4. Si login exitoso → failedAttempts=0, lockedUntil=null
```

---

## 5. Password Reset Flow

```javascript
// Modelo Usuario: agregar campos
resetToken: { type: STRING(255), allowNull: true }
resetTokenExpires: { type: DATE, allowNull: true }

// POST /auth/forgot-password
// 1. Generar token: crypto.randomBytes(32).toString('hex')
// 2. Guardar hash SHA256 en DB (NO el token raw)
// 3. Enviar email con link: /reset-password?token={raw}
// 4. Expiración: 1 hora
// 5. Respuesta genérica SIEMPRE (no revelar si email existe)

// POST /auth/reset-password
// 1. Hashear token recibido con SHA256
// 2. Buscar usuario con resetToken + resetTokenExpires > now
// 3. Actualizar password, limpiar token, resetear lockout

// POST /auth/change-password (autenticado)
// 1. Verificar currentPassword
// 2. Actualizar password
// 3. Limpiar cookies (forzar re-login = invalidar sesión)
```

---

## 6. Rate Limiting

```javascript
// Login: por EMAIL (no IP) — evita bloqueo de oficinas con NAT
keyGenerator: (req) => {
  const email = req.body?.correo?.toLowerCase()?.trim()
  return email ? `login:${email}` : `login:ip:${ipKeyGenerator(req)}`
}
// skipSuccessfulRequests: true
// max: 10 / 15min
// handler: retornar { retryAfterSeconds, unlockTime, code: 'TOO_MANY_REQUESTS' }

// Refresh: limiter SEPARADO del login (20/15min)
// Register: 5/60min
// Global: 500/15min con exempciones para rutas workflow autenticadas
// trust proxy: true (para IP real detrás de load balancer)
```

Frontend: detectar status 429, mostrar countdown con `retryAfterSeconds`.

---

## 7. CSRF — Double Submit Cookie

```javascript
const { doubleCsrf } = require('csrf-csrf')
// Cookie: __csrf, httpOnly, sameSite, secure
// Header: X-CSRF-Token
// Endpoint: GET /api/csrf-token
// Skip: GET/HEAD/OPTIONS + rutas /auth/ y /public/
```

Frontend: fetch CSRF al inicio + cada 30min, agregar header en POST/PUT/DELETE/PATCH.

---

## 8. Helmet — Security Headers

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}))
```

---

## 9. CORS

```javascript
// Producción: DEBE tener CORS_ORIGIN configurado o abortar
if (corsOrigins.length === 0 && isProd) { process.exit(1) }

app.use(cors({
  origin: /* whitelist dinámica */,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  maxAge: 86400,
}))
```

---

## 10. Error Handler

```javascript
// Producción: mensaje genérico
// Desarrollo: err.message
const message = isProd ? 'Error interno del servidor' : err.message
```

No exponer roles, stack traces ni detalles internos en respuestas 403/500.

---

## 11. Input Validation

- express-validator en TODAS las rutas (no solo auth)
- Doble validación en uploads: MIME type + extensión con regex
- `.escape()` solo si se muestra HTML raw, no en datos que van a DB

---

## 12. Access Control (IDOR)

```javascript
// En CADA getById/getHistorial/download:
const isPrivileged = roles.some(r => ['RRHH', 'ADMIN', 'JefeRRHH'].includes(r))
const isOwner = ref.creadoPorUserId === req.auth.id
const isAssigned = ref.asignadoADCUserId === req.auth.id
if (!isPrivileged && !isOwner && !isAssigned) return 403
```

- authRequired en TODAS las rutas (nivel router, no solo controller)
- /uploads protegido con authRequired
- requireRoles() para operaciones admin

---

## 13. Logging — Winston

```javascript
// utils/logger.js
// Dev: console con colores | Prod: JSON + archivos con rotación diaria
// logSecurityEvent(event, { ip, ua, correo, userId, reason })

// Eventos a logear:
// - failed_login (con IP + user-agent)
// - account_locked
// - password_changed / password_reset_completed
// - access_denied (403)

// Request logger: REDACTAR campos sensibles
const REDACTED = ['password', 'refreshToken', 'accessToken', 'token', 'secret', 'apiKey']
```

---

## 14. .env Checklist

```env
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<otro openssl rand -hex 32>
JWT_EXPIRES_IN=20m
CORS_ORIGIN=https://tudominio.com
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true  # SIEMPRE true en prod
ADMIN_PASS=<contraseña fuerte 12+ chars>
SEED_ADMIN=false  # desactivar después del primer seed
```

Nunca commitear `.env`. Verificar que esté en `.gitignore`.

---

## 15. Middleware Order (app.js)

```
1. trust proxy
2. Helmet (security headers)
3. CORS
4. cookie-parser
5. body-parser (JSON + URL-encoded)
6. CSRF protection
7. Rate limiting global
8. Morgan + request logger
9. Static files (con authRequired)
10. Routes
11. Error handler
```
