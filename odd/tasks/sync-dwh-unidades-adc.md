# Unidades de negocio y Administradores de contrato desde el DWH

Estado: SLICE 1 (carga inicial de unidades) en curso, 2026-11-13. Resto del diseño sin aprobar.

## Pedido textual (Alejandro, 2026-11-13)

"mira podemos puedes buscar el proyecto de dhw en aws y establecer una coneccion para sacar
las unidades de negocio y a los cargos de Administradores de contrato"

## Respuestas de Alejandro (diálogo, 2026-11-13)

1. "dhw" = DataWhoreHouse (RDS `ecora-dwh`, us-east-1; repo `~/Documents/GitHub/DataWhoreHouse`).
2. Unidades: **sincronizar el catálogo** (crear/actualizar por código; inactivas → `estado=false`; nunca borrar).
3. Administradores de contrato: **asignar rol ADC y su unidad** a usuarios existentes; no crear usuarios.
4. Conexión: **JSON diario en S3** (sin abrir red entre regiones).
5. Calce ADC ↔ usuario: **agregar RUT al usuario** (lo registra ADMIN en /gestion-roles).

## Hallazgos (consultas agregadas, sin PII, 2026-11-13)

- DWH: `core.dim_unidad_negocio` (codigo_empresa, codigo_unidad, nombre_unidad, estado A/N):
  45 activas, 77 inactivas. `core.dim_persona` vigente: cargo `ADMINISTRADOR DE CONTRATO`
  → 5 ACTIVA (5 unidades distintas, ninguna sin unidad) y 23 INACTIVA.
- DWH sin identidad en `core` (decisión D14 de ese repo): el JSON viaja con RUT y códigos, sin nombres.
- Referidos prod: `unidad_negocio` vacía, `linea_negocio` vacía, 15 usuarios, 1 con rol ADC,
  0 usuarios con RUT (`personas` vacía), `usuario_unidad` vacía.
- Red: RDS del DWH privada (SG solo ETL y reportabilidad); Referidos en sa-east-1.
- La task definition del ETL no tiene `taskRoleArn`: hoy no puede escribir en S3.

## Diseño

### Contrato del archivo (S3)

`s3://<bucket>/referidos/dwh-referidos.json`, escrito al final de cada corrida del ETL:

```json
{ "generado": "2026-11-13T09:05:00Z",
  "unidades": [{ "codigoEmpresa": "01", "codigoUnidad": "C025900000", "nombre": "...", "activa": true }],
  "administradoresContrato": [{ "rut": "12345678K", "codigoEmpresa": "01", "codigoUnidad": "C025900000" }] }
```

Solo ADC con `estado_unisoft = ACTIVA`. RUT en el formato del DWH (sin guion).

### DWH (repo DataWhoreHouse)

- `src/etl/export_referidos.js`: arma el JSON (función pura + consulta) y lo sube con
  `PutObject` (SSE-S3). Paso nuevo al final de `scripts/etl-all.js` (después de dbt).
- Dependencia nueva: `@aws-sdk/client-s3` (justificación: única forma soportada de escribir a S3 desde Node).
- Infra: bucket privado nuevo `ecora-dwh-exports` (us-east-1, Block Public Access, SSE-S3,
  versionado, lifecycle 30 días para versiones viejas); task role `ecora-dwh-etl-task` con
  `s3:PutObject` solo sobre `referidos/*`; `taskRoleArn` en la task definition.

### Referidos (este repo)

- Migración: `unidad_negocio` + `codigo_empresa`, `codigo_unidad` (UNIQUE parcial) y `origen`
  (`manual|dwh`); `usuarios` + `rut` (UNIQUE, normalizado con `src/lib/rut.js`);
  `usuario_rol` + `origen` (`manual|dwh`) para saber qué rol puso la sincronización.
- `src/services/dwhSync.js`: lee el JSON (`GetObject`, credenciales actuales del backend),
  valida forma, y en una transacción:
  1. Unidades: upsert por `(codigo_empresa, codigo_unidad)`; las del catálogo `dwh` ausentes
     o inactivas → `estado=false`. Las `manual` no se tocan.
  2. ADC: por cada RUT del archivo con usuario en Referidos → rol ADC (`origen=dwh`) + su unidad
     en `usuario_unidad`. Usuario con ADC `origen=dwh` que ya no viene → se le quita ese rol
     (revocación de acceso, ISO 27001 A.5.18). Un ADC `manual` nunca se quita.
  3. Cortacircuito: JSON inválido, vacío, o con caída > 50 % de unidades activas respecto de la
     corrida anterior → no aplica nada y avisa en el log.
- Cron diario 07:00 (después del ETL de 06:00) + botón "Sincronizar ahora" para ADMIN.
- `/gestion-roles`: campo RUT por usuario (solo ADMIN lo edita; se valida dígito verificador).
- Logs sin RUT.

## Archivos (lista cerrada; se ajusta al aprobar)

DWH: `src/etl/export_referidos.js`, `test/export_referidos.test.js`, `scripts/etl-all.js`,
`package.json` + lock, `deploy/task-definition.json`, `docs/despliegue-aws.md`.

Referidos backend: `migrations/add-dwh-sync.sql`, `src/services/dwhSync.js`,
`src/db/models/{unidadNegocio,usuario,usuarioRol}.model.js`, controlador y ruta de sincronización,
controlador de usuarios (RUT), `src/server.js` (cron), `src/config.js`, `docs/DEPLOY.md`, pruebas
unitarias e integración. Frontend: `/gestion-roles` (RUT + botón), pruebas.

## Supuestos

- La unidad del ADC es la unidad OPERATIVA vigente de `dim_persona`.
- Un ADC tiene una sola unidad en el DWH (hoy max = 1 por unidad); si un usuario ya tiene otras
  unidades `manual`, se conservan.
- `linea_negocio` queda sin tocar (vacía).
- El rol ADC que hoy tiene el único usuario ADC queda como `manual`.

## Slice 1: carga inicial de unidades (aprobado 2026-11-13)

Alejandro vio /gestion-unidades vacía y eligió "carga ahora y sync después", con alcance
**solo Ecora S.A. (empresa 01)**: 27 unidades reales; fuera las 3 sintéticas `DSV*` del DWH
y las 15 de otras empresas (101 es "EMPRESA EJEMPLO", 102 es alimento de mascotas, y hay
nombres repetidos entre empresas).

- `migrations/add-unidades-dwh.sql`: columnas `codigo_empresa`, `codigo_unidad`, `origen`
  (CHECK manual|dwh), índice único parcial por código, e INSERT de las 27 con `ON CONFLICT DO NOTHING`.
- Probada en Postgres 16 (`tracker-pruebas-db`): dos corridas sin error, 27 filas `dwh` con 27
  códigos distintos, CHECK y UNIQUE rechazan datos malos, alta manual sigue con `origen=manual`.
- Deuda del DWH: `C024900000` llega como `BA�O` desde Unysoft (corregido a BAÑO en la carga).
- Sin cambio de modelo ni de código: la imagen actual ignora las columnas nuevas.

## Checklist

- [ ] Aprobación del diseño
- [ ] DWH: export puro + prueba (TDD)
- [ ] DWH: subida a S3 + paso en etl-all
- [ ] Infra: bucket, task role, política de lectura para Referidos
- [ ] Referidos: migración (probada 2 veces en Postgres 16)
- [ ] Referidos: sync de unidades (TDD)
- [ ] Referidos: sync de ADC con revocación (TDD)
- [ ] Referidos: cron + endpoint ADMIN
- [ ] Frontend: RUT en /gestion-roles + botón
- [ ] Revisor (permisos: obligatorio)
- [ ] Deploy DWH + Referidos y verificación con datos reales

## Criterio de término

Jest, Vitest y `node --test` del DWH en verde; migración probada dos veces; revisor sin
bloqueantes; en producción: 45 unidades activas cargadas y, tras registrar los RUT, los ADC
activos con rol y unidad.

## Siguiente paso

Aprobación de Alejandro del diseño y de la infraestructura nueva (bucket + task role).
