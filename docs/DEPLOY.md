# Despliegue — Sistema de Referidos

Procedimiento para publicar en la EC2 de `sa-east-1`. El stack es
`docker-compose` con imágenes desde ECR y Caddy resolviendo TLS en el borde.

> **Este documento describe el despliegue de `referidos.ecoraapp.com`, cuyo
> `backend.env` apunta a la instancia dedicada `referidos-prod-db` (desde el
> 23-09-2026; sin acceso público) y al bucket `ecora-referidos-prod`.** Esa base
> tiene datos reales: el respaldo del paso 1 no es opcional. La base anterior,
> `referidos_prod` en `database-test`, quedó intacta solo como respaldo de rollback.

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
  --db-instance-identifier referidos-prod-db \
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

Todas son idempotentes (`IF NOT EXISTS` / comprobación en `information_schema`),
así que repetirlas no rompe nada. Van **antes** del código nuevo porque el
backend nuevo lee `token_version` y `gmail_message_id`; el backend viejo las
ignora, de modo que entre la migración y el despliegue el sistema sigue funcionando.

```bash
node src/scripts/migrate.js add-token-version-to-usuarios.sql
node src/scripts/migrate.js create-auditoria-documentos-table.sql
node src/scripts/migrate.js add-gmail-message-id-to-referidos.sql
node src/scripts/migrate.js create-gmail-correos-revisados.sql
node src/scripts/migrate.js create-lista-bloqueo.sql
```

`create-lista-bloqueo.sql` (11-11-2026) es **obligatoria** antes de la imagen que
consulta a black: el modelo `Referido` declara la columna `en_lista_bloqueo` y sin
ella todo `SELECT` sobre `referidos` falla. Crea además `lista_bloqueo_huellas`
(solo huellas HMAC, sin RUT ni nombre). El backend anterior ignora ambas, así que
el rollback de imagen no exige revertirla.

`create-gmail-correos-revisados.sql` (10-11-2026) es **obligatoria** antes de la
imagen que trae la pantalla `/gmail`: el análisis de la casilla consulta la tabla
`gmail_correos_revisados` y falla si no existe. Trae el backfill de los referidos
ya importados desde Gmail. El backend anterior no la usa, así que el rollback de
imagen no exige revertirla.

`add-gmail-message-id-to-referidos.sql` (29-09-2026) es **obligatoria** con
`SYNC_DB=false`: el modelo `Referido` ya declara la columna y sin ella todo
`SELECT` sobre `referidos` falla. Agrega el índice único parcial
`referidos_gmail_message_id_unique`, que impide importar dos veces el mismo
correo de Gmail. Lo importado antes de esta fecha no queda protegido (sin backfill).

`migrate.js` toma la conexión de las variables de entorno vía `dotenv`, así que
hay que ejecutarlo donde esas variables apunten a la base correcta — dentro del
contenedor del backend o en una máquina con el mismo `.env`.

Verificación:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'usuarios' AND column_name = 'token_version';
SELECT to_regclass('auditoria_documentos');
SELECT to_regclass('referidos_gmail_message_id_unique');
SELECT to_regclass('lista_bloqueo_huellas');
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'referidos' AND column_name = 'en_lista_bloqueo';
```

---

## 3. Construir y publicar las imágenes

```bash
aws ecr get-login-password --region sa-east-1 \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

TAG=$(git rev-parse --short HEAD)

docker build -t "$ECR_REGISTRY/referidos-backend:$TAG"  ./backend
docker build -t "$ECR_REGISTRY/referidos-frontend:$TAG" ./frontend
docker build -t "$ECR_REGISTRY/referidos-pdf-analyzer:$TAG" ./services/pdf-analyzer
docker push "$ECR_REGISTRY/referidos-backend:$TAG"
docker push "$ECR_REGISTRY/referidos-frontend:$TAG"
docker push "$ECR_REGISTRY/referidos-pdf-analyzer:$TAG"
```

El build de `pdf-analyzer` corre sus tests dentro de la imagen de compilación: si
fallan en Linux, no hay imagen.

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

Solo se acepta la casilla `reclutamiento@ecora.cl` (`GMAIL_SYNC_EMAIL`): hay que
autorizar con la sesión de Google de esa casilla. Pueden conectarla ADMIN,
JefeRRHH y RRHH.

Los tres rechazos posibles ya tienen mensaje propio en la UI (`invalid_state`,
`forbidden`, `wrong_account`).

### 5.8 Analizador de PDF (sidecar Rust)

El texto de los CV en PDF de la sincronización de Gmail lo extrae el servicio
`pdf-analyzer`. No tiene autenticación: no publica puertos y vive en la red
interna `pdf`, que solo comparte con el backend. `backend.env` debe traer
`PDF_ANALYZER_URL=http://pdf-analyzer:4002`.

```bash
docker compose exec backend node -e "fetch(process.env.PDF_ANALYZER_URL+'/health').then(r=>r.text()).then(console.log)"
curl -m 5 http://<ip-publica>:4002/health   # desde fuera: debe fallar
```

Si el sidecar no responde, la sincronización sigue: el CV queda sin texto y la IA
usa el cuerpo del correo. Los PDF escaneados (sin capa de texto) devuelven vacío;
no hay OCR.

Un PDF que deje al analizador en bucle retiene su único cupo y todo lo demás recibe
503 (los CV quedan sin texto). A los 90 s el proceso se termina solo y Docker lo
levanta de nuevo (`restart: unless-stopped`); queda la línea "se reinicia el proceso"
en `docker compose logs pdf-analyzer`. Si se repite, hay un PDF concreto que lo provoca
(sigue en la casilla y cada vista previa lo reenvía). Con `MAX_CONCURRENCY` mayor que 1,
ese reinicio corta también los análisis sanos en curso.

Cambiar `GMAIL_SYNC_EMAIL` exige reconectar la casilla nueva desde el panel: hasta
entonces la sincronización sigue con el token de la anterior.

### 5.9 Pantalla de Gmail (`/gmail`)

Reemplaza al modal de sincronización. Después de desplegar, con un usuario RRHH:

1. Abrir `/gmail`, analizar 5 correos y abrir la vista previa de un PDF. Si el
   panel queda en blanco y la consola muestra un bloqueo de CSP, la cabecera no
   trae `frame-src blob:` (ver `frontend/nginx.conf`; son tres bloques). Es el
   único cambio de CSP de este lote: el PDF se muestra desde un `blob:` creado
   por la propia página, no desde otro origen.
2. Descartar un correo, analizar de nuevo y confirmar que no aparece; restaurarlo
   desde "Historial" y confirmar que vuelve.

La vista previa no guarda el adjunto en el servidor: lo baja de Gmail y lo entrega
en la misma respuesta. El registro (`gmail_correos_revisados`) guarda solo el id del
correo, remitente, asunto, estado, quién y cuándo. El callback de OAuth ahora vuelve
a `/gmail?gmail_connected=...` (antes `/referidos`); el `redirect_uri` registrado en
Google no cambia.

### 5.10 Lista de no recontratación (black)

Al ingresar una persona se consulta su RUT a black (`black.ecoraapp.com`).
Variables en `backend.env`:

| Variable | Para qué |
|---|---|
| `BLACK_API_URL` | Ruta **completa** de la API de black, `https://` y sin barra final. Ejemplo: `https://black.ecoraapp.com/api/consulta`. Si se configura solo el host, todas las consultas dan 404 y caen al respaldo. |
| `BLACK_API_KEY` | Clave de API de Reclutamiento (cabecera `X-API-Key`). |
| `BLACK_HUELLA_KEY` | Clave para calcular la huella HMAC del RUT; habilita el respaldo local. |

- **Si faltan `BLACK_API_URL` o `BLACK_API_KEY`**: la integración queda apagada.
  No se consulta nada, nadie se rechaza y el arranque no falla.
- **Si falta solo `BLACK_HUELLA_KEY`**: se consulta a black, pero sin respaldo
  local (no se descargan huellas).
- **Si black falla** (timeout de 5 s, 401, 429, 5xx, respuesta inválida): el log
  avisa solo el tipo de falla (nunca el RUT) y se busca la huella en
  `lista_bloqueo_huellas`. Presente → se trata como bloqueado; ausente o sin
  respaldo → el ingreso sigue. Las huellas se refrescan al arrancar y cada hora;
  si el refresco falla se conserva la lista anterior.
- Qué hace un bloqueado: ingreso interno e importaciones de Gmail se **rechazan**
  con un texto fijo; postulaciones y formulario público se **aceptan** como
  PENDIENTE con la marca `en_lista_bloqueo`, que solo ven RRHH, JefeRRHH y ADMIN.

Verificación tras desplegar (sin RUT reales en el log): crear con un RUT libre
debe responder 201; revisar en el log que no aparezca el aviso "black no respondió".

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

## Clave de la base (Secrets Manager)

La clave de RDS rota cada 7 días en Secrets Manager (JSON `{"username","password"}`).
Para que la app la siga sin reinicios, en `backend.env` se define:

```
DB_SECRET_ARN=arn:aws:secretsmanager:sa-east-1:<cuenta>:secret:<nombre>
# opcionales: AWS_REGION (por defecto sa-east-1), DB_SECRET_TTL_MS (por defecto 3600000)
```

- Con `DB_SECRET_ARN`, la clave sale del secreto (cacheada en memoria; se relee si
  vence el TTL o si la base responde `28P01`, autenticación fallida). `DB_PASS` se
  ignora: queda solo como respaldo/desarrollo.
- Solo se usa el campo `password` del secreto (rotación de usuario único; la estrategia de usuarios alternados no está soportada).
- `src/scripts/migrate.js` usa la misma fuente.
- Quien lee el secreto necesita `secretsmanager:GetSecretValue` sobre ese ARN (y
  `kms:Decrypt` si usa una CMK propia). Ojo: como `backend.env` trae
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (usuario `fileeco`), el SDK usa esas
  credenciales y **no** el rol de instancia `referidos-app-ec2`. Ambos tienen el
  permiso; si se rotan o retiran las claves de `fileeco`, el contenedor deja de leer
  el secreto (y sigue con la última clave en memoria hasta el siguiente 28P01).
- Si Secrets Manager no responde, la app sigue con la última clave leída y lo
  registra con `console.warn`; solo falla si nunca pudo leerla.

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
