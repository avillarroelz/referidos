# Módulo Gmail: pantalla propia, vista previa, preguntas de filtro y registro de correos revisados

Estado: IMPLEMENTADO SIN COMMIT NI DEPLOY · Abierta 2026-11-10 · Clasificación: sustancial (auth/permisos, SQL, 3+ archivos, dos repos)

## Pedido textual

> mira quiero que convirtamos ese modal en un modulo completo con su propia pantalla, mismas funciones y otras
> nuevas, como por ejemplo previsualizacion de los documentos, y preguntas de caracteristicas, aparte hay que ir
> dejando un backlog para no repetir los cv de las personas es decir, ir anotando los correos con los que llegan
> para que no vuelvan a aparecer cada vez

Respuestas de Alejandro (diálogo, 2026-11-10):
- Preguntas de características = **preguntas de filtro por CV**: RRHH escribe preguntas y la IA responde
  sí / no / no se sabe leyendo cada CV, con la cita del texto.
- Registro = se anotan **importados y descartados**; pestaña "Historial" para ver y recuperar un descartado.
- Persona ya registrada (mismo email o RUT) que manda otro correo = **mostrar con aviso**; no se importa como
  persona nueva; RRHH adjunta el CV a la ficha existente o descarta.

## Objetivo

Reemplazar `GmailSyncModal` por la pantalla `/gmail` (roles ADMIN, JefeRRHH, RRHH) con las mismas funciones
(conectar/reconectar casilla, buscar por cantidad/fecha/palabras clave, análisis con progreso, edición, importar,
plantilla de correo) más: vista previa del adjunto, preguntas de filtro, descartar, historial, aviso de persona
ya registrada.

## Supuestos

1. Las preguntas viven en el navegador (localStorage); no se guardan en la base. Máx. 5, 200 caracteres c/u.
2. El registro guarda lo mínimo para reconocer un correo: messageId, remitente, asunto, estado, quién y cuándo
   (minimización, Ley 21.719 art. 3 letra c). No guarda texto del CV ni respuestas de la IA.
3. La vista previa no persiste nada: el backend baja el adjunto de Gmail y lo entrega en la misma respuesta.
4. Los CV ya van hoy a la API de Anthropic para extraer datos; las preguntas viajan en esa misma llamada (no hay
   un envío nuevo de datos a un tercero).
5. No se despliega en esta tarea sin que Alejandro lo pida (hay migración de base).

## Contrato de API (fuente de verdad para backend y frontend)

Todas bajo `authRequired` + `requireRoles('RRHH','ADMIN','JefeRRHH')` + `heavyOpsLimiter`.

### Cambia: `GET /api/referidos/sync/gmail/preview?q=&maxResults=&preguntas=` (SSE)
- `preguntas`: opcional, JSON de un arreglo de strings (máx. 5, cada una 1–200 caracteres). Inválido → evento
  `error` `{ error: 'Preguntas no válidas' }` y cierre (los headers SSE ya se enviaron).
- Excluye los correos ya revisados (tabla nueva ∪ `referidos.gmail_message_id`). Lista hasta 500 ids, filtra y
  recién después corta a `maxResults`.
- Evento `total`: `{ total, omitidos }` (`omitidos` = cuántos se saltaron por estar revisados).
- Evento `email`: `email` trae además
  - `attachmentParts[i]`: `{ filename, mimeType, size }` (se deja de enviar `attachmentId`; el índice en el
    arreglo es el identificador para la vista previa),
  - `respuestas`: `[{ pregunta, respuesta: 'si'|'no'|'no_se_sabe', cita: string|null }]` (arreglo vacío si no se
    pidieron preguntas o si la IA no está disponible),
  - `yaRegistrado`: `{ id, nombre } | null` (referido existente con el mismo email o RUT extraído).
- Evento `done`: `{ count }` (sin cambio).

### Nuevo: `GET /api/gmail/correos/:messageId/adjuntos/:index`
- PDF → `200 application/pdf`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`.
- Word (.docx) y .txt → `200 text/plain; charset=utf-8` con el texto extraído.
- Otro tipo → `415 { error }`. Índice inexistente → `404`. Sobre 10 MB → `413`.
- `messageId`: `^[A-Za-z0-9_-]{1,100}$`; `index`: entero 0–49.

### Nuevo: `POST /api/gmail/correos/descartar`
- Body `{ correos: [{ messageId, from, subject }] }` (1–100). Crea filas `descartado`. Idempotente: un correo ya
  anotado no falla ni cambia de estado. Respuesta `{ ok: true, descartados: n }`.

### Nuevo: `GET /api/gmail/correos/historial?estado=&page=&pageSize=`
- `estado` opcional (`importado|descartado`), `page` ≥1, `pageSize` 1–100 (20 por defecto).
- Respuesta `{ items: [{ messageId, estado, remitente, asunto, referidoId, revisadoPor: { id, nombre } | null,
  fecha }], total, page, pageSize }`, más reciente primero.

### Nuevo: `DELETE /api/gmail/correos/:messageId`
- Restaura un descartado (borra la fila) → `{ ok: true }`. Si es `importado` → `409`. Si no existe → `404`.

### Nuevo: `POST /api/gmail/correos/:messageId/adjuntar`
- Body `{ referidoId, from, subject }`. Guarda los adjuntos del correo como documentos del referido existente
  (misma lógica S3/local del import), anota el correo como `importado` con ese `referidoId`, lo marca leído y con
  etiqueta `Referido-Procesado`. Respuesta `{ ok: true, adjuntosGuardados }`. Referido inexistente → `404`.
  Correo ya anotado → `409`.

### Cambia: `POST /api/referidos/sync/gmail/manual`
- Cada item acepta además `from` y `subject` (opcionales, string). Al crear el referido anota el correo como
  `importado`. Si el email/RUT ya existe sigue respondiendo el error `Duplicado: ya existe referido #N`.

### Cambia: callback OAuth de Gmail
- Todas las redirecciones pasan de `/referidos?gmail_*` a `/gmail?gmail_*` (mismos parámetros).

## Datos

Tabla `gmail_correos_revisados` (modelo `GmailCorreoRevisado`):
`id` serial PK · `gmail_message_id` varchar(100) NOT NULL UNIQUE · `estado` varchar(20) NOT NULL
(`importado|descartado`) · `referido_id` int NULL FK `referidos(id)` ON DELETE SET NULL · `remitente` varchar(255)
NULL · `asunto` varchar(255) NULL · `revisado_por_usuario_id` int NULL FK `usuarios(id)` ON DELETE SET NULL ·
`created_at` · `updated_at`.
Migración `backend/migrations/create-gmail-correos-revisados.sql`, idempotente, con backfill desde
`referidos.gmail_message_id` (estado `importado`).

## Alcance (lista cerrada)

Backend:
- `backend/migrations/create-gmail-correos-revisados.sql` (nuevo)
- `backend/src/db/models/gmailCorreoRevisado.model.js` (nuevo), `backend/src/db/modelMap.js`,
  `backend/src/db/associate.js`
- `backend/src/controllers/gmailBandeja.controller.js` (nuevo: adjunto, descartar, historial, restaurar, adjuntar)
- `backend/src/services/gmailAdjuntos.js` (nuevo: guardar adjuntos de un correo en un referido, extraído de
  `syncFromGmailManual`)
- `backend/src/routes/gmail.routes.js`
- `backend/src/controllers/referidos.controller.js` (solo `previewGmail`, `syncFromGmailManual` y sus validadores)
- `backend/src/controllers/gmailController.js` (solo las URLs de redirección del callback)
- `backend/src/services/gmailService.js` (`processOneEmail` acepta preguntas; `attachmentParts` sin `attachmentId`)
- `backend/src/services/emailParserAI.js` (preguntas)
- Tests: `backend/tests/integration/gmail-bandeja.test.js` (nuevo), `gmail-callback-state.test.js`,
  `permisos-matriz.test.js`, `gmail-preview-done.test.js`, `gmail-sync-idempotencia.test.js`,
  `backend/tests/unit/services/emailParserAI.preguntas.test.js` (nuevo) y los unitarios de gmailService que toque.

Frontend (repo anidado `frontend/`):
- `src/pages/GmailPage.jsx` (nuevo) y componentes en `src/components/gmail/` (nuevos)
- `src/services/gmail.js`, `src/router.jsx`
- `src/pages/ReferidosPage.jsx` (el botón Gmail navega a `/gmail`; se va el modal y el manejo de `gmail_*`)
- `src/components/layout/{Sidebar,Navbar,BottomNav}.jsx` (entrada "Gmail")
- `src/components/GmailSyncModal.jsx` y `tests/components/GmailSyncModal.test.jsx` (se eliminan)
- `nginx.conf` (CSP: `frame-src 'none'` → `frame-src blob:`; necesario para mostrar el PDF en un iframe)
- Tests: `tests/pages/GmailPage.test.jsx` (nuevo) y los de router/ReferidosPage que toque.

Docs: `docs/DEPLOY.md` (migración obligatoria antes de la imagen, cambio de CSP), `GMAIL_SETUP.md` si menciona el modal.

Fuera de alcance: OCR, envío de correos al postulante, guardar preguntas/respuestas en la base, deploy.

## Checklist

- [x] B1 Modelo + migración + registro (descartar, historial, restaurar) con tests
- [x] B2 Preview excluye revisados, `omitidos`, `yaRegistrado`, `attachmentParts` sin `attachmentId`
- [x] B3 Vista previa de adjunto
- [x] B4 Preguntas de filtro en `emailParserAI` + preview
- [x] B5 Import anota el correo; `adjuntar` a ficha existente; callback redirige a `/gmail`
- [x] F1 Pantalla `/gmail` con las funciones del modal (paridad) + navegación + retiro del modal
- [x] F2 Vista previa del documento
- [x] F3 Preguntas de filtro (definir, ver respuestas, filtrar)
- [x] F4 Descartar, historial/restaurar, aviso de ya registrado + adjuntar
- [x] Revisor (obligatorio: permisos, SQL, 3+ archivos)
- [x] Verificación en navegador (Chrome, Gmail e IA sintéticos, Postgres desechable) — hecha ANTES de las correcciones del revisor; no repetida después

## Criterios de aceptación

1. jest y vitest en verde, sin debilitar pruebas; lint sin errores nuevos.
2. Un correo importado o descartado no vuelve a salir en el análisis; restaurado, vuelve a salir.
3. EXTERNO, TRABAJADOR y ADC reciben 403 en todas las rutas nuevas (matriz de permisos).
4. El PDF de un correo se ve en la pantalla sin descargarlo ni guardarlo en el servidor.
5. Con preguntas, cada tarjeta muestra sí/no/no se sabe con su cita; sin IA, la pantalla sigue funcionando.
6. Los logs no registran texto de CV, citas ni respuestas.
7. La migración corre dos veces sin error.

## Evidencia

- jest: 49 suites, 1113 pasan, 3 omitidas, 0 fallos (antes 948). vitest: 45 archivos, 754 pasan (antes 681). `npm run build` del frontend sin errores.
- Migración en Postgres 16 (contenedor desechable): corre dos veces sin error; backfill inserta los referidos con messageId; CHECK de estado rechaza valores ajenos; borrar el referido deja `referido_id` en NULL.
- Navegador (Chrome, datos sintéticos): análisis con pregunta y respuesta por tarjeta, vista previa del PDF en dos columnas, importar, "N correos ya revisados no se muestran", aviso "Ya registrado como postulante #1", adjuntar CV a la ficha (2 documentos en la ficha), descartar, historial, restaurar y reaparición del correo.
- CSP: página de prueba con la cabecera exacta de `frontend/nginx.conf`: con `frame-src blob:` Chrome muestra el PDF manteniendo `object-src 'none'`; con `frame-src 'none'` lo bloquea. Firefox sin probar.
- Revisor: sin bloqueantes; 6 mayores. Corregidos: adjuntar sin documentos (422), fuente única de "correo revisado" (`services/gmailRegistro.js`, también en la ruta automática `syncFromGmail`), tope de ids 500 → 2000, citas de la IA verificadas contra el texto, `.doc` binario → 415, token de Gmail vencido → 424 en la bandeja, logs sin nombre de archivo ni de candidato, confirmación en dos pasos al adjuntar, aviso de datos sensibles en las preguntas.
- Fuera de la lista cerrada, a propósito: `middleware/rateLimiters.js` (límite propio de la bandeja: 300 cada 15 min), `middleware/requestLogger.js` (redacta from/subject/remitente/asunto), `services/gmailRegistro.js`, `syncFromGmail`.

## Pendiente / deuda

- DECISIÓN DE ALEJANDRO: retención de `remitente` y `asunto` en `gmail_correos_revisados` (descartados sin plazo; se conservan tras borrar la ficha). Propuesta: anular ambos campos a los 90 días y al suprimir la ficha.
- Dos PDF sintéticos subidos por error al bucket de desarrollo `tracker-referidos` durante la prueba local: `111111111/docs/1794339322246_CV_Ana_Rojas.pdf` y `111111111/docs/1794339395617_CV_Ana_2026.pdf`. Borrarlos es decisión de Alejandro.
- No probado: casilla real (token local revocado), Firefox, pantalla en móvil, navegador después de las correcciones del revisor.
- Las respuestas de la IA se emparejan con las preguntas por posición; el CV se corta a 5000 caracteres antes de ir a la IA (una pregunta sobre la página 3 puede quedar en "no se sabe").
- Los referidos importados antes de `add-gmail-message-id-to-referidos.sql` no tienen messageId: sus correos reaparecen.
- `descartar` no comprueba que el messageId exista en Gmail.

## Progreso

- 2026-11-10: exploración hecha, dudas resueltas con Alejandro, contrato definido.

## Siguiente paso

Commit (raíz y `frontend/`) cuando Alejandro lo confirme. Deploy solo a pedido: correr antes `create-gmail-correos-revisados.sql` (docs/DEPLOY.md §2 y §5.9).
