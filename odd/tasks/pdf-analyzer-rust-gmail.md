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
- [ ] Deploy + verificación con un CV real

## Criterios de aceptación
1. cargo test, clippy, jest y vitest en verde.
2. En producción, la vista previa de Gmail extrae datos de un correo con CV en PDF (`parseSource: ai-doc`)
   y el log del sidecar muestra la petición.
3. El sidecar no es alcanzable desde fuera de la EC2.

## Deuda detectada (revisor, no resuelta)
- El sidecar devuelve imágenes en base64 que el backend descarta; falta `?images=false` o tope de respuesta.
- Un PDF en bucle deja el sidecar en 503 hasta reiniciarlo a mano (sin healthcheck ni autoreinicio).
- Sin tope de PDF por correo ni heartbeat SSE: con el sidecar saturado, un correo con varios PDF puede
  demorar la vista previa más que el timeout del proxy.
- `pdfAnalyzerClient` pierde el status HTTP si la respuesta no es JSON.
- Limitaciones de la plantilla que siguen: sin OCR, ligaduras sin normalizar, imágenes incompletas.

## Evidencia
(pendiente del deploy)

## Progreso / siguiente paso
10-11: tarea registrada. Siguiente: copiar plantilla y correr sus tests.
