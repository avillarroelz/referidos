# Import de Gmail: relleno desde el remitente y sin personas repetidas

Estado: CERRADA, en deploy (2026-11-13). Revisor: 2 rondas, sin bloqueantes.

## Pedido textual (Alejandro, 2026-11-13)

"otra cosas cunado importandomos con gmail quiero que mejoremos el relleno de nombre correo
gmail cuando importamos ademas quiero que no repitamos correos"

## Respuestas de Alejandro (diálogo, 2026-11-13)

1. Relleno: **del remitente según quién envía**. Remitente externo = postulante (su nombre y correo
   rellenan lo que falte). Remitente `@ecora.cl` = quien refiere (su nombre va a `nombreReferidor`,
   no se toma como postulante). Lo que trae el CV/IA siempre manda.
2. "No repetir": las tres —
   a. no importar a quien ya existe (correo o RUT ya en Referidos),
   b. unir duplicados del mismo análisis (una tarjeta, la del correo más reciente),
   c. ocultar correos ya revisados (YA FUNCIONA: `idsYaRevisados`, cubierto por
      `tests/integration/gmail-preview-done.test.js`; no se toca).

## Causa raíz de los duplicados

`buscarYaRegistrado` (vista previa), `syncFromGmailManual` y el import automático
(`syncFromGmail`) comparan RUT y correo **exactos**: `12.345.678-5` ≠ `12345678-5` y
`Juan@Gmail.com` ≠ `juan@gmail.com`. Además nada une repetidos dentro de un mismo análisis.

## Diseño

1. Helper único `buscarReferidoExistente({ rut, email })` (p. ej. en `src/services/referidoDuplicado.js`):
   - RUT: `normalizarRut` (`src/lib/rut.js`); si es válido, busca con `Op.in` sobre sus variantes
     de escritura (con/sin puntos, con/sin guion, k/K). Sin migración de datos y funciona en
     SQLite (pruebas) y Postgres.
   - Correo: `trim` + minúsculas, comparado con `where(fn('lower', col('email')), ...)`.
   - Lo usan los 3 puntos: vista previa (`yaRegistrado`), import manual, import automático.
2. Vista previa (SSE): durante el loop se lleva un set de claves (RUT normalizado, correo en
   minúsculas). Gmail lista del más reciente al más antiguo: el primero se queda; los siguientes
   de la misma persona salen con `duplicadoDe: <messageId del primero>`. El frontend los oculta
   de la lista y muestra cuántos se unieron.
3. Relleno desde el remitente en `gmailService.processOneEmail`, después de la IA/regex:
   - Parsear `From` (`"Nombre" <correo>` o solo correo).
   - Dominio = `config.auth.internalEmailDomain` → `nombreReferidor` ← nombre del remitente si falta.
   - Externo y no automático → `nombre` y `email` ← remitente solo si faltan.
   - Automáticos (no-reply, noreply, notificaciones, mailer-daemon, postmaster, portales) → nada.
   - Nunca pisa un valor que ya trajo la IA/regex.

## Archivos (lista cerrada)

Backend: `src/services/gmailService.js`, `src/controllers/referidos.controller.js`, nuevo
`src/services/referidoDuplicado.js` (o nombre equivalente), pruebas en `tests/unit/services/` y
`tests/integration/gmail-preview-done.test.js` / `gmail-sync-idempotencia.test.js`.
Frontend: `src/pages/GmailPage.jsx` (ocultar `duplicadoDe` + aviso de cuántos), su prueba
`tests/pages/GmailPage.test.jsx`.

## Criterio de término

Pruebas nuevas vistas en rojo y luego en verde; Jest y Vitest completos en verde; build OK;
revisor sin bloqueantes. Sin commit ni deploy hasta que Alejandro lo apruebe.

## Siguiente paso

Implementador: slices con TDD (helper → 3 puntos → unión en preview → relleno → frontend).

## Evidencia (2026-11-13)

Pruebas nuevas por slice y su rojo observado:

1. Helper `src/services/referidoDuplicado.js` (`buscarReferidoExistente`, `clavesDePersona`):
   `tests/unit/services/referidoDuplicado.test.js` (9). Rojo: modulo inexistente (suite no cargaba).
   Se escribieron juntas las 9 del helper (no una a una); cubren RUT con/sin puntos, sin guion,
   k/K, DV invalido, correo con mayusculas/espacios, sin datos.
2. Uso en los 3 puntos (3 rojos por comparacion exacta, verdes tras usar el helper):
   - preview: `gmail-preview-done.test.js` "yaRegistrado ignora puntos/guion/k...".
   - manual: `gmail-sync-idempotencia.test.js` "un duplicado que solo difiere en formato...".
   - automatico: `gmail-sync-idempotencia.test.js` "no crea a quien ya existe con otro formato...".
3. Union en preview: `gmail-preview-done.test.js` "une a la misma persona repetida...". Rojo: `duplicadoDe` undefined.
4. Relleno desde el remitente: `gmailService.pdf.test.js` (bloque "relleno desde el remitente", 11 casos).
   Rojos: 5 (externo, sin comillas, solo el campo que falta, @ecora.cl, caida a regex). Un segundo rojo
   por bug propio del parseo de `From` (el nombre opcional se comia la 1a letra del correo): corregido.
   Se ajusto la expectativa de "separa las respuestas" (email null ahora se completa con el remitente externo).
5. Frontend: `GmailPage.test.jsx` "oculta los correos repetidos... (duplicadoDe)". Rojo: no existia el aviso.

Resultados finales:
- Jest completo (`npx jest --runInBand`, backend): 54 suites pasan / 1299 pasan / 3 omitidas (linea base 53 / 1273 / 3; +1 suite, +26 pruebas).
- Vitest completo: 48 archivos / 773 pasan (linea base 772 + 1 nueva).
- `npm run build` (frontend): OK (solo aviso de chunks > 500 kB, preexistente).


## Correcciones del revisor (2026-11-13)

Pruebas nuevas y rojo observado (cada grupo se vio en rojo antes del código):

1. Correo del remitente no es identidad. `referidoDuplicado.test.js`: marca `rellenadoDesdeRemitente` /
   flag `emailDesdeRemitente` ignorados por `buscarReferidoExistente` y `clavesDePersona` (rojo: el correo
   contaba). Integración (preview, manual, automático): dos correos del mismo remitente externo, sin
   email ni RUT propios, no se unen, no marcan `yaRegistrado` y ambos se importan (estas pasaron de inmediato
   porque el helper ya estaba corregido; el rojo del slice fue el unitario). El flag del manual se valida con
   `isBoolean({ strict: true })`: rojo en "emailDesdeRemitente debe ser booleano" (200 en vez de 400).
   `gmailService`: `extractedData.rellenadoDesdeRemitente` lista lo rellenado (rojo: no existía).
2. MIME (RFC 2047): decodificador propio mínimo en `gmailService.js` (`nodemailer` es dependencia directa
   pero no expone un decodificador público de encabezados; `libmime`/`mailparser` no son dependencias
   directas). Pruebas Q utf-8, B base64, Q iso-8859-1, palabras contiguas, mezcla con texto plano y charset
   desconocido (nombre null, correo conservado). Rojo: el nombre salía sin decodificar.
3. RUT con DV inválido: siempre se agrega la condición exacta `{ rut: texto.trim() }` y `clavesDePersona`
   usa `rutcrudo:` cuando `normalizarRut` da ''. Pruebas unitaria e integración (manual). Rojo: no detectaba.
4. Límite de variantes de RUT documentado en un comentario del helper (sin ramificar SQL por dialecto).
5. Frontend: los repetidos ya no se ocultan. `groupByPerson` agrupa por `duplicadoDe`; la principal es la
   que trae adjuntos, luego la de más campos extraídos, luego la más reciente; las demás van colapsadas
   bajo "Ver N correo(s) más de esta persona" y son seleccionables. Solo la principal viene marcada por
   defecto. Pruebas: principal con adjunto + expandir, desempate por campos, selección por defecto
   (solo la principal), flag `emailDesdeRemitente` true/false según edición del usuario. Rojo: 5 pruebas.
   La prueba anterior ("oculta los correos repetidos...") se reemplazó por la del nuevo comportamiento.
6. Remitente `@ecora.cl` solo con `Authentication-Results` (o `ARC-Authentication-Results` si falta) con
   `dkim=pass header.d=<dominio>` o `dmarc=pass header.from=<dominio>`; `parseEmailContent` expone
   `authResults` (se usa solo el primer header, el del servidor receptor). Sin autenticación: no se rellena
   nada. Nombre con '@' se descarta. Pruebas: dkim pass, dmarc pass, ARC, dkim fail, pass de otro dominio,
   dominio con sufijo igual, header ausente. Rojo: rellenaba sin validar.
7. Bordes de `From`: más de un `<...>` o coma fuera de comillas -> sin parseo; se quitan `\` y control; nombre
   a 100 caracteres; dominio con `lastIndexOf('@')` (`boss@ecora.cl@evil.com` es externo). Una prueba por caso.
8. Automáticos ampliados: no-responder / noresponder / no_responder / no.responder, info, contacto, newsletter.

Decisiones abiertas: el flag del manual compara el correo editable con el extraído (si el usuario lo cambia
deja de ser "del remitente"). `info@`/`contacto@` se tratan como automáticos aunque una persona real los use.

Deuda (anotada en `.claude/memoria/_propuesta.md` sección 9, no implementada): migración que normalice
`referidos.rut`; índice funcional `lower(email)`; unión no transitiva; subdominios internos como externos.

Resultados tras las correcciones:
- Jest completo (`npx jest --runInBand`, backend): 54 suites pasan / 1337 pasan / 3 omitidas.
- Vitest completo (frontend): 48 archivos / 777 pasan. Una corrida con Jest en paralelo dio un fallo intermitente
  en `ReferidosPage.kanban.test.jsx` (ajeno; pasa solo y en la corrida limpia).
- `npm run build` (frontend): OK.

## Correcciones del revisor (2ª ronda) (2026-11-13)

- **C1, correo de relleno = clave débil.** Solo identifica si además coincide el nombre normalizado
  (mayúsculas, sin tildes, espacios colapsados). `clavesDePersona` genera `emailnombre:<email>|<NOMBRE>`
  (sin nombre, sin clave). `buscarReferidoExistente` trae los candidatos por `lower(email)` y compara el
  nombre normalizado en JS (quitar tildes en SQL no es portable SQLite/Postgres). Pruebas unitarias (rojo:
  4, el correo de relleno se ignoraba del todo) e integración: preview (distinto nombre no se une; mismo
  nombre se une y marca `yaRegistrado`), manual (distinto nombre se importa, mismo nombre es duplicado) y
  automático (distinto nombre se crea; mismo nombre `skipped`). Las integraciones de preview y automático
  pasaron al instante porque el helper ya estaba corregido; el rojo de integración fue el manual.
- **C2, el servidor decide.** Se eliminó `emailDesdeRemitente` del validador, del helper y del frontend. En el
  import manual el correo es "de relleno" si coincide (sin mayúsculas) con el correo parseado de `item.from`
  (`parsearRemitente`). Pruebas: coincide con el From -> distinto nombre se importa y mismo nombre es duplicado
  (rojo); un correo distinto del From sigue siendo identidad aunque el cliente mande `emailDesdeRemitente: true`;
  frontend: no manda ningún flag (rojo: lo mandaba). DECISIÓN: `parsearRemitente` (con el decodificador MIME y
  la limpieza de nombre) se movió de `gmailService.js` a `referidoDuplicado.js` porque el controlador necesita
  usarlo y las pruebas mockean `gmailService` completo; `referidoDuplicado.js` carga la base de forma
  perezosa (dentro de `buscarReferidoExistente`) para que `gmailService` pueda importarlo sin base de datos.
- **C3.** Solo se acepta el `Authentication-Results` cuyo authserv-id (texto antes del primer `;`, minúsculas)
  es `mx.google.com`; entre varios se usa ese. Pruebas (rojo): otro authserv-id con `dmarc=pass` no rellena;
  con dos headers gana el de `mx.google.com` (que aquí dice fail).
- **C4.** Se eliminó el respaldo a `ARC-Authentication-Results`. La prueba "ARC sirve" se reemplazó por una
  que verifica que un ARC solo no habilita el relleno interno (rojo).

Resultados tras la 2ª ronda:
- Jest completo (`npx jest --runInBand`, backend): 54 suites pasan / 1345 pasan / 3 omitidas, `EXIT=0`.
- Vitest completo (frontend): 48 archivos / 776 pasan.
- `npm run build` (frontend): OK.

## Deuda aceptada al cerrar (2026-11-13)

- `parsearRemitente` (decodificador MIME + `limpiarNombre`) vive en `src/services/referidoDuplicado.js` porque las pruebas mockean `gmailService` completo; moverlo a `src/lib/remitente.js` (Alejandro eligió desplegar sin moverlo).
- `item.from` del import manual lo envía el cliente: un usuario RRHH podría forzar "correo de relleno" y debilitar la detección por correo (impacto: duplicado, no permisos).
