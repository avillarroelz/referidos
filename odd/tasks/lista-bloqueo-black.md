# Consulta a black (lista de no recontratación) al ingresar personas

Estado: DESPLEGADO 2026-11-13 09:55, tag `6194ddd` (incluye `db1946d`, pantalla /gmail). Cerrada.

## Pedido textual (Alejandro, 2026-11-11)

"mira necesito que te conectes a la aplicacion de black.ecoraapp.com para bloquear a los
postulantes que esten bloqueados"

Adjuntó las instrucciones que black dejó para Reclutamiento (mismo contrato de API).

## Respuestas de Alejandro (diálogo, 2026-11-11)

1. Ingreso interno o importación Gmail de un RUT bloqueado: **rechazar el ingreso**.
2. Postulante externo (postulación propia o formulario público) bloqueado: **aceptar y
   marcar interno**, sin avisarle.
3. Si black no responde: "crear una pequeña lista de los ruts bloqueados" → **huellas HMAC
   descargadas desde black**, usadas solo cuando black falla.
4. El cambio en black lo hace **la otra sesión** (instrucciones al final).
5. La ficha marcada queda **PENDIENTE con marca**; RRHH la rechaza a mano.
6. Commit previo del módulo Gmail: hecho (`db1946d` raíz, `4dc182e` frontend).

## Supuestos

- Solo personas nuevas; las fichas existentes no se barren contra black.
- RUT ausente o con dígito verificador inválido no se puede consultar: el ingreso sigue.
- Si black falla y el RUT no está en la lista local (o no hay lista): el ingreso sigue y
  queda un aviso en el log, sin RUT.
- La vista previa de Gmail no consulta black (cada consulta queda auditada en black y el
  límite es 120 por minuto); se consulta recién al importar.
- No se lee, guarda ni muestra `nombre` ni `motivo` de la respuesta de black.

## Contrato de black

- `GET {BLACK_API_URL}/{rut}` con `X-API-Key`. RUT sin puntos, con guion (`12345678-5`).
  200 `{ bloqueado: boolean, ... }` · 400 · 401 · 429.
- `GET {BLACK_API_URL}` → `{ huellas: [hex64, ...] }`; huella =
  `HMAC-SHA256(clave de huella, rut normalizado)` en hex. Hoy solo para Reclutamiento.

## Diseño en Referidos

Configuración (`backend.env`; las tres vacías = integración apagada, el arranque no falla):
`BLACK_API_URL` (https), `BLACK_API_KEY`, `BLACK_HUELLA_KEY`.

- `src/lib/rut.js`: `normalizarRut(valor)` → `12345678-5` o `''` (acepta puntos y falta de
  guion; exige dígito verificador correcto).
- `src/services/listaBloqueoClient.js`: `consultarRut(rut)` → `{ bloqueado }`;
  `listarHuellas()` → `string[]`. `fetch` nativo, 5 s, `redirect: 'error'`, sin dependencias.
- `src/services/listaBloqueo.js`: `verificarRut(rut)` →
  `{ bloqueado, fuente: 'black' | 'respaldo' | 'sin_verificar' }`; nunca lanza.
  `actualizarHuellas()` reemplaza la tabla local; si falla conserva la anterior.
- Tabla `lista_bloqueo_huellas (huella CHAR(64) PK, created_at)`.
- Columna `referidos.en_lista_bloqueo BOOLEAN NOT NULL DEFAULT false`.
- Refresco de huellas al arrancar y cada hora (junto al cron de SLA).

Puntos de ingreso:

| Entrada | Si está bloqueado |
|---|---|
| `POST /api/referidos` | 500 genérico "No se pudo crear el referido" (decisión 2026-11-13, no revela el bloqueo); no crea |
| `POST /api/referidos/sync/gmail/manual` | error por ítem con el texto fijo; no crea |
| `POST /api/referidos/sync/gmail` | no crea; cuenta como error |
| `POST /api/postulaciones` | crea PENDIENTE con `enListaBloqueo = true`; respuesta igual |
| formulario público | igual que postulaciones |

Texto fijo: "No se puede ingresar a esta persona: está en la lista de no recontratación.
Contacta a Recursos Humanos."

Visibilidad: `enListaBloqueo` solo sale en respuestas a RRHH, JefeRRHH y ADMIN. Nunca a
TRABAJADOR, ADC, EXTERNO ni anónimo; tampoco en el historial de estados.

Frontend: aviso "En lista de no recontratación" en la tarjeta y en el detalle de la ficha.

## Archivos (lista cerrada)

Backend nuevos: `src/lib/rut.js`, `src/services/listaBloqueoClient.js`,
`src/services/listaBloqueo.js`, `src/db/models/listaBloqueoHuella.model.js`,
`migrations/create-lista-bloqueo.sql`, pruebas `tests/unit/lib/rut.test.js`,
`tests/unit/services/listaBloqueoClient.test.js`, `tests/unit/services/listaBloqueo.test.js`,
`tests/integration/lista-bloqueo.test.js`.

Backend modificados: `src/config.js`, `src/db/modelMap.js`, `src/db/models/referido.model.js`,
`src/controllers/referidos.controller.js`, `src/controllers/postulaciones.controller.js`,
`src/controllers/publicReferidos.controller.js`, `src/server.js`, `docs/DEPLOY.md`.

Frontend (`frontend/`, repo anidado): nuevo `src/components/referidos/BlockListBadge.jsx`;
modificados `ReferidoCard.jsx`, `ReferidoTableRow.jsx`, `ReferidoKanban.jsx`, `ReferidoDrawer.jsx`,
`src/pages/RevisarReferidosPage.jsx` (`/revisar/:id`);
pruebas: `tests/components/referidos/ReferidoCard.test.jsx`, `ReferidoTableRow.test.jsx`,
`ReferidoKanban.test.jsx` (nueva), `ReferidoDrawer.test.jsx` (nueva), `tests/pages/AgregarReferidoPage.test.jsx`,
`tests/pages/RevisarReferidosPage.test.jsx` (nueva).

## Checklist

- [x] RUT: normalización y dígito verificador
- [x] Cliente de black (consulta y huellas)
- [x] Servicio con respaldo local y refresco
- [x] Migración y modelo
- [x] Rechazo en ingreso interno y en las dos importaciones Gmail
- [x] Marca en postulación y formulario público
- [x] Visibilidad de la marca por rol
- [x] Frontend: aviso en tarjeta y detalle
- [x] Revisor (backend; sin bloqueantes, 7 correcciones aplicadas)
- [x] Suites completas en verde (confirmado por orquestador 2026-11-12: Jest 53/53 suites, 1273 pasan, 3 omitidas. Implementadores: Jest 53 suites, 1273 pasan, 3 omitidas; Vitest 48 archivos, 770 pasan; build OK. La corrida de confirmación del orquestador se cortó por falta de memoria del equipo, no por un fallo)

## Criterio de término

Jest y Vitest completos en verde, migración probada dos veces en Postgres 16, revisor sin
bloqueantes, y una consulta real a black con `12345678-5` → `bloqueado: false` (requiere la
clave; la corre Alejandro o la autoriza).

## Evidencia

Backend (2026-11-11), sin commit ni deploy:
- Pruebas nuevas: 160 (rut 32, cliente 44, servicio 34, integración 50), cada slice visto en rojo antes del código.
- Jest completo (`npx jest --runInBand`): 53 suites pasan; 1273 pasan, 3 omitidas, 0 fallan (base: 49 / 1113 / 3).
- Correcciones del revisor (backend): RUT tolera espacios, puntos y guiones Unicode (U+2010 a U+2015, U+2212); `crearVerificador()` da cortacircuito por lote en las dos importaciones Gmail (black caído = 1 solo fetch); cuerpo de respuestas no 200 se descarta; 401/403 van a `console.error` con mensaje fijo (también en `actualizarHuellas`); vector fijo de huella `HMAC('k'*32, '12345678-5')` = `de94cae2...3257` probado vía `verificarRut`; DEPLOY.md aclara que `BLACK_API_URL` lleva la ruta completa; migración usa `ADD COLUMN IF NOT EXISTS`.
- Visibilidad: `defaultScope` del modelo Referido excluye `enListaBloqueo` de toda lectura; RRHH/JefeRRHH/ADMIN usan `Referido.scope('conMarca')` en listado y detalle; la respuesta de creación la quita. Probado para TRABAJADOR, ADC, EXTERNO y anónimo.
- Desviación: la migración usa VARCHAR(64) con CHECK hex (igual al modelo STRING(64)) en vez de CHAR(64).
- Migración `create-lista-bloqueo.sql` NO probada en Postgres (pendiente, criterio de término).

Frontend (2026-11-11), sin commit ni deploy:
- Pruebas nuevas: 13 (Card 3, TableRow 3, Kanban 3, Drawer 3, AgregarReferidoPage 1: el 403 con `error` se muestra tal cual; la página ya lo hacía vía `err.message` del interceptor, sin cambio de código). Slices de Card/Row/Kanban/Drawer vistos en rojo antes del código.
- Página de detalle `/revisar/:id` (`RevisarReferidosPage.jsx`): aviso entre el encabezado y la barra de progreso, antes de las acciones de estado. Prueba con `true` vista en rojo; negativas `false`/sin clave. +3 pruebas. Insignia + indicación (`role="status"`) reutilizadas del drawer mediante `BlockListNotice` (export de `BlockListBadge.jsx`).
- Vitest completo (`npx vitest run`): 48 archivos, 770 pruebas pasan, 0 fallan (base: 45 / 754). `npm run build`: OK.
- El aviso se muestra solo si `enListaBloqueo === true` (5 sitios, componentes `BlockListBadge` y `BlockListNotice`). No se tocó MisReferidoCard, ADCReferidoCard, MisPostulacionesPage ni pantallas públicas.
- Pantalla `/gmail` (`ImportResult.jsx`) ya muestra `err.error` por ítem; sin cambios.
- Decisión pendiente: `src/lib/export.js` (`formatReferidosForExport`) no incluye la columna; no se agregó.

- Migración (orquestador): corre dos veces sin error en Postgres 16, sobre la base de pruebas y sobre una base limpia; el CHECK rechaza huellas mal formadas.
- Revisor: decisiones abiertas para Alejandro: (1) RESUELTA 2026-11-13: el ingreso interno responde el 500 genérico de creación en vez del 403 con texto (pruebas vistas en rojo, 190/190 en verde); (2) un RUT con dígito verificador inválido entra sin consulta; (3) la exportación no incluye la marca.
- Deuda anotada: el correo de un bloqueado no se anota en Gmail y vuelve a consultarse; el aviso por correo a RRHH no menciona la marca; el frontend no fue auditado por el revisor.

- Consulta real a black (2026-11-13, autorizada por Alejandro al entregar los secretos): `GET /api/consulta/12345678-5` → 200 `bloqueado: false`; `GET /api/consulta` → 38 huellas, todas hex64. Claves leídas de Secrets Manager (`lista-bloqueo/referidos-api-key`, `lista-bloqueo/referidos-huella-key`, us-east-1) sin imprimirse.

- Deploy 2026-11-13 (tag `6194ddd`): snapshot `referidos-pre-deploy-20261113-0949`; migraciones `create-gmail-correos-revisados.sql` y `create-lista-bloqueo.sql` con la imagen nueva (tablas y columna verificadas); respaldos `.env.bak-pre-6194ddd` y `backend.env.bak-pre-6194ddd` en `/opt/referidos`; al arrancar, `lista_bloqueo_huellas` = 38; health 200, 6 cabeceras, `/gmail` 200, 0 avisos de black en el log. pdf-analyzer retagueado en ECR (misma imagen que `03862af`).
- Incidente menor: las 3 variables BLACK_ ya las había agregado otra sesión a las 09:48; quedaron duplicadas con valores idénticos (comparados por hash) y se quitó el duplicado restaurando el respaldo. Sin reinicio.
- Rollback: `TAG=03862af` en `/opt/referidos/.env` + `docker compose up -d`. Las migraciones son aditivas; las variables BLACK_ las ignora la imagen anterior.

## Pendiente fuera de este repo

- black: HECHO 2026-11-13. Consumidor Referidos con clave propia y clave de huella propia; `BLACK_API_URL=https://black.ecoraapp.com/api/consulta`.
- AWS/EC2: HECHO 2026-11-13.

## Siguiente paso

Con memoria libre: `npx jest --runInBand` en `backend/`. Luego commit (raíz y `frontend/`) si Alejandro lo aprueba. Antes del deploy: clave de huella en black, tres variables en `backend.env`, migración.
