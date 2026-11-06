# /postular: barra solo con logo + certificados de estudio

## Pedido (textual)
> en el link de https://referidos.ecoraapp.com/postular me gustaria que quitaramos de la barra superior el boton de registro inicio o login , y solo dejemos el logo con un link a la misma pagina estp para mantener al usuario aqui dentro de este formulario porque ingresaran solo usuarios que no corresponden a nuestra organizacion y ademas quiero que agreguemos un agregar documentos para certificado de estudio (solo pdf y hasta 3 DOCUMENTOS para que incluya el certificado de 4to medio y el de estudios superiores)

## Decisiones (Alejandro, 06-11)
- Certificados: sección nueva y separada, **obligatorio al menos 1**, máx. 3, solo PDF (10 MB c/u). "Documentos adicionales" sigue igual.
- Barra en /postular: **solo logo para todos** (con o sin sesión), el logo lleva a /postular.
- RRHH distingue los certificados por **prefijo en el nombre**: `Certificado de estudio - <archivo>.pdf`. Sin migración.

## Alcance (lista cerrada)
Backend:
- `src/routes/public.routes.js`, `src/routes/postulaciones.routes.js` (campo `certificados`, maxCount 3)
- `src/controllers/postulaciones.controller.js` (obligatorio, PDF, prefijo)
- `tests/integration/postulaciones-upload.test.js` (+ casos; los existentes adjuntan un certificado: el contrato cambió)
- `tests/integration/s3-fallo-no-silencioso.test.js` solo si el nuevo requisito lo rompe
Frontend (submódulo):
- `src/components/layout/Navbar.jsx` (modo `soloLogo`), `src/layouts/AppLayout.jsx` (agregado: con sesión en escritorio se ve Sidebar y en móvil BottomNav, no el Navbar), `tests/components/layout/AppLayout.test.jsx` (nuevo)
- `src/pages/PostulacionPublicaPage.jsx`, `tests/pages/PostulacionPublicaPage.test.jsx` (nuevo)

## Checklist
- [x] B1 certificado se guarda con prefijo (201); nombre recortado a 200
- [x] B2 sin certificado → 400
- [x] B3 certificado no PDF → 400; más de 3 → 400
- [x] F1 /postular: solo logo → /postular, sin Ingresar/Registrarse, Sidebar, BottomNav ni utilidades (4 tests)
- [x] F2 Sección certificados: obligatoria, máx 3, PDF, se envía como `certificados` (5 tests)
- [x] Suites completas: back 44 suites / 929 ok / 3 skip; front 42 archivos / 671 ok (06-11)
- [x] Revisor: sin bloqueantes. Corregido: /Postular en mayúsculas (TDD), temporales verificados en rechazos. Decisión Alejandro: quitar TODAS las salidas del formulario (enlaces a Mis postulaciones / Mi cuenta y "No, terminar"; éxito solo ofrece "Sí, hacer otra"). Deuda en `_propuesta.md` §8
- [x] Commits front `9288df1` + raíz `2872c1d`, push
- [x] Deploy 06-11 09:45 (`2872c1d`, snapshot `referidos-pre-deploy-20261106-0940`). Verificado: bundle publicado trae la sección de certificados y no trae "No, terminar"; POST público sin certificado → 400 "Debes adjuntar al menos un certificado de estudio en PDF". Rollback: `TAG=74ad80d` (`.env.bak-pre-2872c1d`)

## Criterios de aceptación
1. Jest y Vitest completos en verde.
2. En prod, /postular muestra solo el logo; enviar sin certificado se bloquea; con 1–3 PDF se crea y RRHH ve "Certificado de estudio - …".

## Progreso / siguiente paso
06-11: CERRADO salvo prueba visual y envío real con certificados (lo hace Alejandro o RRHH).
