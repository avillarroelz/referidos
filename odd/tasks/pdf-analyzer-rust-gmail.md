# Analizador de PDF en Rust para los CV de la sincronización de Gmail

## Pedido textual (2026-11-10)
> "quiero que utilices la skill /pdf-rust-analyzer para analizar los curriculums que tenemos en funcion"

Aclarado por pregunta: **reemplazar pdf-parse en la sincronización de Gmail** y **desplegar hoy**.

## Objetivo
El texto de los CV en PDF que llegan por Gmail lo extrae el servicio Rust de la skill
`pdf-rust-analyzer` (sidecar HTTP), no `pdf-parse`.

## Problema
`gmailService.extractTextFromFile` usa `pdf-parse` dentro del proceso del backend: un PDF hostil
(bomba de compresión) se procesa entero en el mismo proceso que atiende la API.

## Alcance (lista cerrada)
- `services/pdf-analyzer/**` (plantilla de la skill + Dockerfile + cambios en `src/main.rs`)
- `backend/src/services/pdfAnalyzerClient.js` (nuevo; CommonJS como el resto del backend)
- `backend/src/services/gmailService.js` (solo la rama PDF de `extractTextFromFile`)
- `backend/tests/unit/services/gmailService.pdf.test.js`, `backend/tests/integration/pdf-analyzer.test.js`
- `backend/package.json` + lock (retirar `pdf-parse`), `backend/.env.example`, `.env.deploy.example`
- `docker-compose.yml`, `docs/DEPLOY.md`
- Infra: repositorio ECR `referidos-pdf-analyzer`; `PDF_ANALYZER_URL` en `backend.env` de la EC2

Fuera de alcance: analizar los CV de `/postular`, OCR, Word (sigue con mammoth).

## Supuestos
- EC2 x86_64, 2 vCPU, 1,9 GB RAM (≈1,2 GB disponibles): concurrencia 1 y límite de memoria al contenedor.
- El sidecar no publica puertos: solo lo alcanza el backend por la red interna de compose.
- Si el sidecar no responde, el CV queda sin texto y la IA usa el cuerpo del correo (igual que hoy ante error).

## Checklist
- [x] Plantilla copiada; `cargo test --release` (20 de la plantilla + 4 del limitador = 24) y clippy limpios
- [x] Limitación 1: semáforo de concurrencia (`MAX_CONCURRENCY`), 503 si la cola no avanza en 10 s
- [x] Limitación 2: el cupo se libera cuando el análisis TERMINA, no cuando vence el timeout
- [x] `HOST` configurable (por defecto 127.0.0.1; 0.0.0.0 solo dentro del contenedor)
- [x] Cliente Node + test de integración (válido, corrupto 400, bomba 422, no-PDF 415)
- [x] `gmailService` usa el cliente (TDD) y se retira `pdf-parse`. jest 941 pasan / 3 omitidas
- [x] Dockerfile + compose; imagen probada en Linux con read-only, cap-drop ALL y 768 MB (200/400/422)
- [x] Revisor: sin bloqueantes. Aplicado: `cpus` y `pids_limit`; reinicio documentado en DEPLOY 5.8
- [x] Deploy + verificación con CV reales (10-11, tag `8c6f907`)

## Criterios de aceptación
1. cargo test, clippy, jest y vitest en verde.
2. En producción, la vista previa de Gmail extrae datos de un correo con CV en PDF (`parseSource: ai-doc`)
   y el log del sidecar muestra la petición.
3. El sidecar no es alcanzable desde fuera de la EC2.

## Segunda pasada (10-11, tarde): deuda del revisor resuelta
- `?images=false`: el backend ya no recibe las imágenes del CV.
- Vigilante: si un análisis sigue sin terminar 60 s después de su timeout, el proceso sale y Docker lo levanta.
- `pdfAnalyzerClient` conserva el status HTTP ante una respuesta que no es JSON, sin copiar el cuerpo al error.
- (Gmail) el permiso de una cuenta rechazada por `wrong_account` se revoca en Google.

- Revisor (segunda auditoría, sin bloqueantes): la vigilancia ahora parte con el hilo y no depende de que el
  cliente siga conectado; la revocación no toca la casilla hoy conectada; la reparación no clona el documento
  y tiene tope de 64 MB.
- Evidencia 10-11 13:14, tag `03862af`: mismos 8 PDF reales, 6 con texto (los 2 vacíos son escaneados);
  respuesta del sidecar para esos 8 PDF: 1969 KB con imágenes → 28 KB sin ellas. Rust 31 tests, jest 948 pasan.
  Sidecar: 10 MB, 0 reinicios. Rollback inmediato: `TAG=8c6f907` (`.env.bak-pre-03862af`).

## Deuda detectada (revisor, no resuelta)
- `revokeToken` y `getProfile` del callback de Gmail no tienen timeout propio.
- El backend no distingue "CV escaneado" de "analizador caído": en ambos casos el CV queda sin texto.
- Un PDF que deje pegado al analizador sigue en la casilla y cada vista previa lo reenvía (~90 s sin análisis cada vez).
- Sin tope de PDF por correo ni heartbeat SSE: con el sidecar saturado, un correo con varios PDF puede
  demorar la vista previa más que el timeout del proxy.
- Limitaciones de la plantilla que siguen: sin OCR, ligaduras sin normalizar, imágenes incompletas.

## Evidencia
- 10-11 12:27 producción en `8c6f907` (backend, frontend y pdf-analyzer). Health 200, 6 cabeceras, base conectada.
- Aislamiento: el backend responde `/health` del sidecar; el frontend no resuelve `pdf-analyzer`; desde fuera el 4002 no responde.
- Vista previa real (10 correos): 4 `ai-doc`. Extracción directa en el contenedor sobre esos 10 correos:
  8 PDF, 6 con texto (860 a 7068 caracteres, 7 a 55 ms), 2 con 0 caracteres y sin error (escaneados, sin OCR).
- Hallazgo en producción: pdf-extract rechazaba 2 de esos PDF con "invalid file trailer". Arreglado en `8c6f907`
  (se reescribe el documento con lopdf 0.47 y se reintenta); ahora entregan 5781 y 5832 caracteres. 27 tests.
- Sidecar tras la prueba: 9 MB, 0 reinicios, sin OOM.
- Rollback: `TAG=289962b` con `docker-compose.yml.bak-pre-9243787` (el compose anterior no conoce el sidecar ni ese tag de pdf-analyzer).

## Progreso / siguiente paso
10-11: CERRADO. Queda la deuda listada arriba; la más útil es OCR para los CV escaneados (2 de 8 en la muestra).
