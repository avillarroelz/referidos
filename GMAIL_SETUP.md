# Configuración de Gmail API

## Guía paso a paso para habilitar la integración con Gmail

### 1. Crear proyecto en Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un nuevo proyecto o selecciona uno existente
3. Dale un nombre descriptivo (ej: "Tracking Referidos")

### 2. Habilitar Gmail API

1. En el menú lateral, ve a **APIs y servicios** → **Biblioteca**
2. Busca "Gmail API"
3. Haz clic en "Gmail API" y luego en **HABILITAR**

### 3. Configurar pantalla de consentimiento OAuth

1. Ve a **APIs y servicios** → **Pantalla de consentimiento de OAuth**
2. Selecciona **Externo** (a menos que uses Google Workspace)
3. Completa la información básica:
   - Nombre de la aplicación: `Tracking Referidos`
   - Correo electrónico de asistencia: tu correo
   - Correo del desarrollador: tu correo
4. Haz clic en **Guardar y continuar**
5. En **Ámbitos**, haz clic en **AÑADIR O QUITAR ÁMBITOS**
6. Busca y agrega estos tres ámbitos:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
7. Guarda y continúa
8. En **Usuarios de prueba**, agrega tu correo de Gmail
9. Finaliza la configuración

### 4. Crear credenciales OAuth2

1. Ve a **APIs y servicios** → **Credenciales**
2. Haz clic en **+ CREAR CREDENCIALES** → **ID de cliente de OAuth**
3. Tipo de aplicación: **Aplicación web**
4. Nombre: `Tracking Referidos - Backend`
5. En **Orígenes de JavaScript autorizados**, agrega:
   - `http://localhost:4000`
6. En **URI de redirección autorizados**, agrega:
   - `http://localhost:4000/api/gmail/oauth2callback`
7. Haz clic en **CREAR**
8. Se mostrará una ventana con tu **Client ID** y **Client Secret**
9. **¡GUARDA ESTOS VALORES!** Los necesitarás en el siguiente paso

### 5. Configurar variables de entorno

Edita el archivo `backend/.env` y completa las siguientes variables:

```env
GMAIL_CLIENT_ID=tu_client_id_aqui.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=tu_client_secret_aqui
GMAIL_REDIRECT_URI=http://localhost:4000/api/gmail/oauth2callback
```

### 6. Obtener el Refresh Token

#### Paso 1: Obtener la URL de autorización

Realiza una petición GET al endpoint:

```bash
curl http://localhost:4000/api/gmail/auth-url \
  -H "Authorization: Bearer TU_TOKEN_JWT"
```

Respuesta:
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...",
  "instructions": "Visita esta URL para autorizar la aplicación..."
}
```

#### Paso 2: Autorizar la aplicación

1. Copia la URL de `authUrl` y ábrela en tu navegador
2. Inicia sesión con la cuenta de Gmail que quieres conectar
3. Acepta los permisos solicitados
4. Serás redirigido a `http://localhost:4000/api/gmail/oauth2callback?code=...`
5. **Copia el valor del parámetro `code`** de la URL

#### Paso 3: Intercambiar el código por tokens

Usa este comando para obtener tu refresh_token:

```bash
curl -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "code=TU_CODIGO_AQUI" \
  -d "client_id=TU_CLIENT_ID" \
  -d "client_secret=TU_CLIENT_SECRET" \
  -d "redirect_uri=http://localhost:4000/api/gmail/oauth2callback" \
  -d "grant_type=authorization_code"
```

Respuesta:
```json
{
  "access_token": "...",
  "expires_in": 3599,
  "refresh_token": "1//...",  ← ¡GUARDA ESTE VALOR!
  "scope": "https://www.googleapis.com/auth/gmail.readonly ...",
  "token_type": "Bearer"
}
```

**IMPORTANTE**: Guarda el `refresh_token` de forma segura. Lo necesitarás para cada petición.

---

## Uso de la API

### 1. Vista previa de correos (sin crear referidos)

```bash
POST http://localhost:4000/api/gmail/preview
Authorization: Bearer TU_TOKEN_JWT
Content-Type: application/json

{
  "query": "subject:referido is:unread",
  "maxResults": 10,
  "credentials": {
    "refresh_token": "TU_REFRESH_TOKEN"
  }
}
```

**Respuesta**:
```json
{
  "count": 3,
  "emails": [
    {
      "id": "18c7f3a2b4d5e6f7",
      "subject": "Referido: Juan Pérez",
      "from": "maria@ejemplo.com",
      "date": "Mon, 24 Nov 2025 10:30:00 -0300",
      "extractedData": {
        "nombre": "Juan Pérez",
        "email": "juan.perez@gmail.com",
        "telefono": "+56912345678",
        "rut": "12.345.678-9",
        "cargo": "Desarrollador"
      }
    }
  ]
}
```

### 2. Procesar correos y crear referidos

```bash
POST http://localhost:4000/api/gmail/process
Authorization: Bearer TU_TOKEN_JWT
Content-Type: application/json

{
  "query": "subject:referido is:unread",
  "maxResults": 50,
  "autoMarkRead": true,
  "addLabel": true,
  "credentials": {
    "refresh_token": "TU_REFRESH_TOKEN"
  }
}
```

**Respuesta**:
```json
{
  "success": true,
  "message": "Se procesaron 5 correos, se crearon 4 referidos",
  "processed": 5,
  "created": 4,
  "errors": [
    {
      "messageId": "...",
      "error": "No se pudo extraer el nombre del referido"
    }
  ],
  "referidos": [
    {
      "id": 123,
      "nombre": "Juan Pérez",
      "messageId": "18c7f3a2b4d5e6f7"
    }
  ]
}
```

**Parámetros opcionales**:
- `query`: Búsqueda personalizada (default: `"subject:referido is:unread"`)
- `maxResults`: Máximo de correos a procesar (default: `50`)
- `autoMarkRead`: Marcar correos como leídos (default: `true`)
- `addLabel`: Agregar etiqueta "Referido-Procesado" (default: `true`)

---

## Formato esperado de los correos

El sistema extrae automáticamente la siguiente información usando regex:

### Patrones reconocidos:

- **Nombre**: `nombre: Juan Pérez` o `candidato: María González`
- **Email**: Cualquier formato válido de email
- **Teléfono**: `+56912345678` o `9 1234 5678` o `912345678`
- **RUT**: `12.345.678-9` o `12345678-9`
- **Cargo**: `cargo: Desarrollador` o `posición: Ingeniero`

### Ejemplo de correo válido:

```
Asunto: Referido: Juan Pérez

Hola,

Les recomiendo a Juan Pérez para la vacante de Desarrollador.

Nombre: Juan Pérez
Email: juan.perez@gmail.com
Teléfono: +56912345678
RUT: 12.345.678-9
Cargo: Desarrollador Full Stack

Saludos
```

---

## Seguridad

⚠️ **NUNCA** subas el `refresh_token` a un repositorio público

✅ **Buenas prácticas**:
- Guarda el refresh_token en una base de datos encriptada
- Usa variables de entorno para desarrollo local
- Implementa rotación de tokens
- Limita los permisos de OAuth solo a lo necesario

---

## Solución de problemas

### Error: "Gmail API no configurada"
→ Verifica que `GMAIL_CLIENT_ID` esté en `.env`

### Error: "invalid_grant"
→ El código de autorización expiró. Genera uno nuevo desde `/api/gmail/auth-url`

### Error: "No tienes permisos para procesar correos"
→ Solo usuarios con rol `ADMIN` o `RRHH` pueden usar estos endpoints

### No se extraen datos del correo
→ Verifica que el correo siga el formato esperado con los patrones reconocidos

---

## Próximos pasos

Para una mejor experiencia, considera:

1. **Crear una UI en el frontend** para:
   - Conectar cuentas de Gmail
   - Previsualizar correos antes de procesarlos
   - Ver historial de importaciones

2. **Almacenar el refresh_token** de forma segura en la base de datos

3. **Programar importaciones automáticas** usando cron jobs

4. **Mejorar los patrones de extracción** según tus necesidades específicas
