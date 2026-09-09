# Despliegue — Sistema de Referidos

Procedimiento para publicar en la EC2 de `sa-east-1`. El stack es
`docker-compose` con imágenes desde ECR y Caddy resolviendo TLS en el borde.

> **Este documento describe el despliegue del entorno cuyo `backend.env` apunta a
> `database-test` / `referidos_test` / `ecora-referidos-test`.** Si se despliega
> contra la base productiva, todo lo de abajo aplica igual pero el paso 1 deja de
> ser opcional.

---

## 0. Antes de tocar nada: verificar `SYNC_DB`

```bash
grep SYNC_DB backend.env
```

`server.js:69` ejecuta `sequelize.sync({ alter: true })` cuando `SYNC_DB=true`.
`alter: true` compara los modelos con las tablas reales y **altera el esquema en
cada arranque**: puede cambiar tipos, agregar columnas y, según el caso, perder
datos. En un entorno con datos que importen debe estar en `false`, y el esquema
se mueve solo por migraciones.

- **`SYNC_DB=false`** → las migraciones del paso 2 son **obligatorias**.
- **`SYNC_DB=true`** → conviene pasarlo a `false` y correr las migraciones a
  mano. Si se deja en `true`, el arranque crearía `auditoria_documentos` y
  `token_version` por su cuenta, pero también aplicaría cualquier otra
  diferencia entre modelos y tablas sin que nadie la revise.

---

## 1. Respaldo

Snapshot de RDS antes de migrar. Es el único punto de retorno real: las
migraciones de este lote son aditivas y no borran datos, pero el respaldo cubre
lo que `sync({ alter: true })` pudiera haber hecho si estaba activo.

```bash
aws rds create-db-snapshot \
  --db-instance-identifier database-test \
  --db-snapshot-identifier referidos-pre-deploy-$(date +%Y%m%d-%H%M) \
  --region sa-east-1
```

Anotar además el tag de las imágenes actualmente en marcha, que es a lo que se
vuelve si hay que revertir:

```bash
docker compose images
```

---

## 2. Migraciones (antes de la imagen nueva)

Las dos son idempotentes (`IF NOT EXISTS` / comprobación en `information_schema`),
así que repetirlas no rompe nada. Van **antes** del código nuevo porque el
backend nuevo lee `token_version`; el backend viejo ignora ambas, de modo que
entre la migración y el despliegue el sistema sigue funcionando.

```bash
node src/scripts/migrate.js add-token-version-to-usuarios.sql
node src/scripts/migrate.js create-auditoria-documentos-table.sql
```

`migrate.js` toma la conexión de las variables de entorno vía `dotenv`, así que
hay que ejecutarlo donde esas variables apunten a la base correcta — dentro del
contenedor del backend o en una máquina con el mismo `.env`.

Verificación:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'usuarios' AND column_name = 'token_version';
SELECT to_regclass('auditoria_documentos');
```

---

## 3. Construir y publicar las imágenes

```bash
aws ecr get-login-password --region sa-east-1 \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

TAG=$(git rev-parse --short HEAD)

docker build -t "$ECR_REGISTRY/referidos-backend:$TAG"  ./backend
docker build -t "$ECR_REGISTRY/referidos-frontend:$TAG" ./frontend
docker push "$ECR_REGISTRY/referidos-backend:$TAG"
docker push "$ECR_REGISTRY/referidos-frontend:$TAG"
```

Usar el hash del commit como tag en vez de `latest` hace que revertir sea
cambiar una variable, y no reconstruir.

---

## 4. Desplegar

En la EC2, con `TAG` apuntando al hash recién publicado:

```bash
export TAG=<hash>
docker compose pull
docker compose up -d
docker compose logs -f backend
```

En el arranque del backend hay que ver `✅ DB conectada` y `🚀 API en ...`.
Un `⚠️ SMTP no verificó` no bloquea el arranque.

---

## 5. Verificaciones después del despliegue

Ordenadas por lo que más duele si está roto.

### 5.1 La aplicación responde

```bash
curl -sS https://referidos.ecoraapp.com/api/health
curl -sSI https://referidos.ecoraapp.com/ | head -1
```

### 5.2 Cabeceras de seguridad (nuevas en este despliegue)

```bash
curl -sSI https://referidos.ecoraapp.com/ | grep -iE 'content-security-policy|x-frame-options|referrer-policy|strict-transport'
```

Deben aparecer las seis. **Verificar también una ruta del SPA** (por ejemplo
`/mis-postulaciones`) y un archivo de `/assets/`: nginx no hereda `add_header`
en un `location` que declara los suyos, y por eso el bloque está repetido. Si
las cabeceras salen en `/` pero no en una ruta interna, el `nginx.conf` se
tocó mal.

### 5.3 La app carga de verdad en el navegador

Es la verificación que ninguna prueba cubre. Abrir la consola del navegador y
comprobar que **no haya errores de CSP**. Mirar en particular:

- los gráficos de KPIs (usan estilos inline),
- los toasts,
- las fuentes,
- los avatares de Google en el listado de referidores,
- el selector de cargos (sale a App Runner, está permitido en `connect-src`).

Si algo aparece bloqueado por CSP, es en `frontend/nginx.conf` y se corrige ahí.

### 5.4 Rate limit por IP — la verificación más importante de este lote

Se agregó un techo de **30 intentos fallidos por IP cada 15 minutos** en el
login, y la clave del contador es `req.ip`. Detrás de Caddy, `req.ip` depende de
`trust proxy`, que en producción vale `1`. **Si la resolución fuera incorrecta,
todas las peticiones compartirían una única clave y 30 fallos de cualquiera
bloquearían el login de toda la empresa.**

Comprobación: hacer un login fallido y mirar en los logs del backend que la IP
registrada sea la del cliente y no una interna del stack de Docker.

```bash
docker compose logs backend | grep -i "login" | tail -20
```

### 5.5 Sesiones vivas

`tokenVersion` se compara con `?? 0`, así que los tokens emitidos antes del
despliegue siguen valiendo hasta vencer y **nadie debería ser expulsado**. Si
alguien reporta que se le cerró la sesión, revisar ahí primero.

### 5.6 Revocación (el motivo de este lote)

Con una cuenta de prueba: iniciar sesión, cambiar la contraseña, y comprobar que
la sesión anterior **no puede renovar**. Es el comportamiento nuevo.

### 5.7 Conexión de la casilla de Gmail

El callback ahora exige un `state` firmado y atado a una cookie. Reconectar la
casilla desde el panel, en **el mismo navegador**, y sin dejar pasar más de diez
minutos entre iniciar y autorizar. Si se completa en otro navegador o se demora
más, va a fallar: es intencional.

Los dos rechazos posibles ya tienen mensaje propio en la UI (`invalid_state`,
`forbidden`).

---

## 6. Rollback

```bash
export TAG=<hash anterior>
docker compose pull && docker compose up -d
```

Las migraciones **no** hay que revertirlas: son aditivas y el código anterior
ignora tanto `token_version` como `auditoria_documentos`. Volver a la imagen
previa deja el sistema exactamente como estaba.

Si hubiera que revertir la base —solo si `sync({ alter: true })` hizo algo
inesperado— se restaura el snapshot del paso 1.

---

## Qué entra en este despliegue

| Cambio | Efecto visible |
|---|---|
| Autorización por rol en Gmail/sync | Un TRABAJADOR ya no alcanza esos endpoints |
| `state` firmado en el callback de Gmail | Reconectar la casilla exige mismo navegador y <10 min |
| Revocación por `tokenVersion` | Cambiar la contraseña cierra las demás sesiones |
| Techo por IP en el login | 30 fallos por IP cada 15 min |
| Reglas de borrado de adjuntos | El postulante solo borra en PENDIENTE; el ADC nunca |
| Auditoría de borrados | Cada borrado deja fila en `auditoria_documentos` |
| Adjuntos por relación | JefeRRHH y ADC asignado ya pueden descargar el CV |
| Handlers async envueltos | Un fallo de base devuelve 500 en vez de colgar la petición |
| Cabeceras de seguridad | La app deja de ser enmarcable |
| Sanitización de la exportación | Las celdas que empiezan con `=`, `+`, `-`, `@` salen con apóstrofo |
| Purga de tokens legacy | Se limpian `tr_access_token` y `tr_refresh_token` del navegador |
| Redacción de logs | Contraseñas y datos personales dejan de escribirse en claro |
