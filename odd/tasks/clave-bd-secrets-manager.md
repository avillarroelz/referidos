# Clave de la BD desde Secrets Manager (rotación de 7 días)

## Pedido (textual)
> haz el parche pero tambien empieza con el arreglo definitivo

## Objetivo
Que la rotación automática de la clave de `referidos-prod-db` (cada 7 días) no deje la app sin base.

## Problema
La clave rota en Secrets Manager y el backend la tiene fija en `DB_PASS` (`/opt/referidos/backend.env`).
Tras cada rotación todo acceso a la base falla con 28P01 (el login con Google fue el síntoma reportado).
Ya se parchó a mano el 30-09, el 13-10 y el 05-11 (respaldos `backend.env.bak-pre-*`).
Próxima rotación: **2026-11-11 20:59 -03**.

## Alcance (lista cerrada)
- `backend/src/config.js`, `backend/src/db/dbPassword.js` (nuevo), `backend/src/db/connection.js`
- `backend/src/scripts/migrate.js`, `backend/tests/setup.js`
- `backend/tests/unit/services/dbPassword.test.js`, `backend/tests/unit/db/connection.test.js` (nuevos)
- `docs/DEPLOY.md`
- Fuera de alcance: `createTestDb.js` y `runMigration.js` (scripts de dev con `DB_PASS`), Node 26 (deploy aparte).

## Checklist
- [x] Parche en prod: `DB_PASS` actualizado desde el secreto en la EC2, backend recreado (05-11 13:42)
- [x] `dbPassword` con caché, TTL, lectura única en vuelo y reintento ante 28P01 (13 tests)
- [x] Test del cableado en `connection.js` con Sequelize real (rojo verificado sin el envoltorio)
- [x] Tildes mal codificadas corregidas
- [x] Suite completa en verde: 44 suites, 924 pasan, 3 skip (05-11)
- [x] Revisor: sin bloqueantes. Corregidos con TDD: `used` capturado antes de conectar (cfg compartido), respaldo con la clave anterior si Secrets Manager cae, la ventana antirebote solo se consume con lectura real
- [x] Lectura del secreto desde el contenedor de prod con credenciales de `fileeco`: OK (incluye KMS)
- [ ] Commit
- [ ] Deploy: imagen nueva + `DB_SECRET_ARN` en `backend.env`
- [ ] Aceptación en prod: `aws secretsmanager rotate-secret` forzado y la app sigue respondiendo sin reinicio

## Criterios de aceptación
1. Jest completo en verde.
2. En prod, tras una rotación forzada, el login funciona sin tocar la EC2 y el log muestra cero 28P01 persistentes.

## Evidencia
- Logs 05-11 16:16Z: `[auth] Error en callback de Google: password authentication failed for user "postgres"`.
- Secreto: `LastRotatedDate 2026-11-04T14:09`, `RotationRules 7 días`.
- Permisos: rol `referidos-app-ec2` y usuario `fileeco` (sus credenciales están en el contenedor y el SDK las toma primero) tienen `GetSecretValue` sobre el ARN.

## Progreso / siguiente paso
05-11: código, tests (18 de dbPassword/cableado) y revisor listos. Siguiente: suite completa → commit → deploy (con confirmación) → rotación forzada.
