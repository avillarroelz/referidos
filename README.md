# Tracking de Referidos

Sistema integral de gestión y seguimiento de candidatos referidos y postulantes externos para Ecora.

## Arquitectura

```
tracker/
├─ backend/        Node.js + Express + Sequelize 6 + PostgreSQL (RDS) + S3
├─ frontend/       Vite + React 19 + React Router 7 + Zustand + TanStack Query + Tailwind 4
└─ migrations/     SQL idempotentes (ejecutados con scripts/migrate.js)
```

- **Backend** (`/backend`): API REST en `:47821` (configurable). Auth con JWT en cookies httpOnly + CSRF double-submit. Login con correo/contraseña y con Google OAuth.
- **Frontend** (`/frontend`): SPA en `:51842`. Repo git separado (subdirectorio).
- **BD**: PostgreSQL en AWS RDS.
- **Almacenamiento**: AWS S3 (`tracker-referidos`) para CVs y adjuntos.

## Roles del sistema

| Rol | Acceso |
|---|---|
| `TRABAJADOR` | Agregar y ver sus propios referidos. |
| `RRHH` | Lo anterior + ver todos los referidos, cambiar estados, asignar ADC. |
| `JefeRRHH` | Lo anterior + aprobar referidos para envío a ADC. |
| `ADMIN` | Total — gestiona usuarios, roles, unidades. |
| `ADC` | Revisa y dictamina referidos asignados. |
| `EXTERNO` | Postulante externo (no `@ecora.cl`). Solo accede a `/mis-postulaciones`, `/postular`, `/mi-cuenta`. |

El rol `EXTERNO` se asigna automáticamente al registrarse (con Google o email/password) si el correo **no** termina en `@ecora.cl` (configurable vía `INTERNAL_EMAIL_DOMAIN`).

## Estados del referido (BPM)

```
PENDIENTE → EN_REVISION → APROBADO_JEFE → ENVIADO_ADC → VALIDADO_ADC → CONTACTADO → APROBADO → CONTRATADO
                ↓             ↓               ↓                              ↓                ↓
            RECHAZADO    LISTA_ESPERA    RECHAZADO_ADC                  RECHAZADO       NO_CONTRATADO
```

Reglas de transición en `backend/src/lib/estados.js` (y espejo en `frontend/src/lib/estadosReferido.js`).

## Levantar el proyecto

### Requisitos
- Node.js 20+
- npm
- Acceso a una BD PostgreSQL
- (opcional) Credenciales de AWS S3, Google OAuth, Anthropic

### Backend

```bash
cd backend
cp .env.example .env       # editar con tus credenciales
npm install
npm run dev                # nodemon, recarga automática
```

API en `http://localhost:47821`.

**Primera vez**: pon `SEED_ADMIN=true` y `SEED_ROLES=true` en `.env` para crear el admin y los roles base.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

SPA en `http://localhost:51842`.

## Migraciones

Todas las migraciones SQL viven en `backend/migrations/`. Para ejecutar una:

```bash
cd backend
node src/scripts/migrate.js <archivo.sql>
```

Las migraciones son idempotentes (usan `IF NOT EXISTS` / `IF EXISTS`).

Migraciones aplicadas hasta hoy:
- `add-google-oauth-columns.sql` — campos OAuth en `usuarios`
- `add-postulante-user-id.sql` — `postulante_user_id` en `referidos` (postulación externa)
- `drop-rut-unique-from-referidos.sql` — quitar `UNIQUE(rut)` (misma persona puede postular a varios cargos)

## Endpoints principales

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| `POST` | `/api/auth/login` | — | Email + contraseña |
| `POST` | `/api/auth/register` | — | Asigna rol por dominio (interno/EXTERNO) |
| `GET` | `/api/auth/google` | — | Inicia login con Google |
| `GET` | `/api/auth/me` | ✅ | Datos del usuario |
| `PATCH` | `/api/auth/me` | ✅ | Editar nombre/correo |
| `POST` | `/api/auth/change-password` | ✅ | Cambiar contraseña |
| `GET` | `/api/referidos` | ✅ | Lista (con `?mine=1` para solo los propios) |
| `POST` | `/api/referidos` | ✅ | Crear referido |
| `PATCH` | `/api/referidos/:id/estado` | RRHH/ADMIN/JefeRRHH | Cambiar estado (con transición válida) |
| `POST` | `/api/postulaciones` | ✅ | Postulación con CV PDF (multipart) |
| `GET` | `/api/postulaciones/mias` | ✅ | Mis postulaciones |
| `POST` | `/api/public/postulaciones` | — | Postulación pública con CV PDF |
| `POST` | `/api/public/referidos` | — | Referir candidato sin sesión |
| `POST` | `/api/roles/usuarios` | ADMIN | Crear usuario |
| `PATCH` | `/api/roles/usuarios/:id` | ADMIN | Editar/habilitar |
| `PATCH` | `/api/roles/usuarios/:id/password` | ADMIN | Resetear contraseña |

## Seguridad

- **CSRF**: double-submit cookie en métodos mutantes (`POST/PUT/PATCH/DELETE`). Excluidos: `/auth/*`, `/public/*`, `/integracion/*`, `/csrf-token`, `/health`.
- **Rate limiting** por ruta: login (5/15min), register (3/h), public form (5/15min), heavy ops (10/min), global (1000/15min).
- **Account lockout** después de 5 intentos fallidos (30 min).
- **Helmet + CSP**, `trust proxy` configurado por entorno.
- **JWT en cookies httpOnly** (nunca en localStorage). Refresh token rotativo.
- **Bcrypt** para contraseñas.

## Comandos útiles

```bash
# Backend
npm run dev               # desarrollo (nodemon)
npm test                  # tests con Jest

# Frontend
npm run dev               # desarrollo (Vite)
npm run build             # build producción
npm test                  # tests con Vitest

# Migraciones
node src/scripts/migrate.js <archivo.sql>

# SMTP OAuth2 (obtener refresh token)
node src/scripts/getSmtpRefreshToken.js
```

## Variables de entorno

Ver `backend/.env.example` para la lista completa. Las críticas son:
- `JWT_SECRET`, `JWT_REFRESH_SECRET` (distintos)
- `DB_*`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `INTERNAL_EMAIL_DOMAIN` (default `ecora.cl`)
- `AWS_*` para S3
- `INTEGRACION_API_KEY` para integraciones externas

## Pendientes / Roadmap

- [ ] SMTP OAuth2: completar `SMTP_OAUTH_REFRESH_TOKEN` (los correos no salen hasta entonces)
- [ ] Dockerfile + docker-compose
- [ ] CI con GitHub Actions
- [ ] Sentry para errores en producción
- [ ] Backups automáticos de PostgreSQL
- [ ] Migrar de `sync({ alter: true })` a migraciones reales para todo el esquema
