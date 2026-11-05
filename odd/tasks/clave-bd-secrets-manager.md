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
- [x] Commit `74ad80d`
- [x] Deploy 05-11 14:19: backend `74ad80d`, frontend retag del mismo digest de `1350e6f`, `DB_SECRET_ARN` en `backend.env`. Snapshot `referidos-pre-deploy-20261105-1413`
- [x] Aceptación: rotación forzada 14:21; `DB_PASS` quedó vieja y los logins consultan la base sin reinicio, 0 × 28P01 después. Un solo fallo a las 14:20:42, dentro de la ventana en que RDS cambia la clave antes de publicarla (esperable)

## Criterios de aceptación
1. Jest completo en verde.
2. En prod, tras una rotación forzada, el login funciona sin tocar la EC2 y el log muestra cero 28P01 persistentes.

## Evidencia
- Logs 05-11 16:16Z: `[auth] Error en callback de Google: password authentication failed for user "postgres"`.
- Secreto: `LastRotatedDate 2026-11-04T14:09`, `RotationRules 7 días`.
- Permisos: rol `referidos-app-ec2` y usuario `fileeco` (sus credenciales están en el contenedor y el SDK las toma primero) tienen `GetSecretValue` sobre el ARN.

## Progreso / siguiente paso
05-11: CERRADO. Rollback: `TAG=1350e6f` en `/opt/referidos/.env` + `backend.env.bak-pre-74ad80d` (con la clave vigente en DB_PASS, que hoy quedó vieja: releerla del secreto).
