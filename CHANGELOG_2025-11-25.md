# Changelog - 25 de Noviembre de 2025

## Resumen de Cambios Realizados

Este documento detalla todas las mejoras, correcciones y nuevas funcionalidades implementadas en el sistema de Tracking de Referidos durante la sesión del 25 de noviembre de 2025.

---

## 🔧 Correcciones de Errores Críticos

### 1. **Problema de Puerto del Frontend** ✅
- **Problema**: El frontend se iniciaba en puertos diferentes (5173, 5174) causando errores de redirección en Google OAuth
- **Solución**: Configuración de puerto fijo en `vite.config.js`
  ```javascript
  server: {
    port: 5173,
    strictPort: true, // Fallar si el puerto ya está en uso
    host: true
  }
  ```
- **Archivo modificado**: `frontend/vite.config.js`

### 2. **Callback de Gmail OAuth** ✅
- **Problema**: Redirección accidental a `/api/gmail/oauth2callback` durante login con Google
- **Solución**: Endpoint público que redirige al frontend sin error 401
- **Archivo modificado**: `backend/src/routes/gmail.routes.js`

### 3. **Rutas de Adjuntos (404 Error)** ✅
- **Problema**: Las rutas `/api/referidos/:id/adjuntos` devolvían 404
- **Causa**: Las rutas estaban mal anidadas en `routes/index.js`
- **Solución**:
  - Eliminada la ruta incorrecta de `routes/index.js`
  - Anidada correctamente en `routes/referidos.routes.js`
- **Archivos modificados**:
  - `backend/src/routes/index.js`
  - `backend/src/routes/referidos.routes.js`

### 4. **Tipos de Archivo No Permitidos** ✅
- **Problema**: Error 500 al intentar subir archivos .doc y .docx
- **Solución**: Ampliación de tipos MIME permitidos en middleware de upload
  ```javascript
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
  ```
- **Archivo modificado**: `backend/src/middleware/upload.js`

---

## 🆕 Nuevas Funcionalidades

### 1. **Sistema de Descarga de Documentos** ✅

#### Backend
- **Nuevo endpoint**: `GET /api/referidos/:id/adjuntos/:docId/download`
- **Funcionalidad**:
  - Genera URLs firmadas de S3 para archivos remotos (válidas 5 minutos)
  - Sirve archivos locales directamente
  - Soporte para autenticación por token en query string
- **Archivos modificados**:
  - `backend/src/controllers/adjuntos.controller.js`
  - `backend/src/routes/adjuntos.routes.js`
  - `backend/src/middleware/auth.js` (soporte para `?token=`)

#### Frontend
- **Componente mejorado**: `UploadSection.jsx`
- **Funcionalidad**:
  - Botón de descarga para cada archivo
  - Apertura en nueva pestaña con token de seguridad
  - Notificaciones de estado

### 2. **Estructura Organizada en AWS S3** ✅

#### Nueva Estructura de Carpetas
```
referidos/
  └── {RUT}/              # RUT del referido (sin puntos ni guión)
      ├── {referidoId_1}/ # Primera referencia de la persona
      │   └── documento/
      │       └── timestamp_archivo.pdf
      └── {referidoId_2}/ # Segunda referencia de la misma persona
          └── documento/
              └── timestamp_archivo.pdf
```

#### Beneficios
- ✅ Agrupa todos los referidos de una misma persona por RUT
- ✅ Permite múltiples referidos de la misma persona
- ✅ Organización jerárquica y escalable
- ✅ Búsqueda más eficiente

#### Archivos modificados
- `backend/src/services/s3Service.js`
- `backend/src/controllers/adjuntos.controller.js`

### 3. **Visualización Mejorada de Adjuntos en Lista de Referidos** ✅

#### Backend
- **Modificación**: Inclusión de documentos adjuntos al listar referidos
- **Archivo modificado**: `backend/src/controllers/referidos.controller.js`
  ```javascript
  include: [
    { model: Usuario, as: 'creadoPor', attributes: ['id', 'username', 'correo'] },
    { model: Documento, as: 'adjuntos', attributes: ['id', 'nombre', 'ruta', 's3Key', 'mimetype', 'size'] }
  ]
  ```

#### Frontend - Rediseño Visual Completo
- **Archivo modificado**: `frontend/src/pages/ReferidosPage.jsx`

##### Mejoras Visuales Implementadas:

1. **Tabla Profesional**
   - Encabezados con fondo gris y texto en mayúsculas
   - Espaciado generoso (px-4 py-4)
   - Separadores sutiles entre filas
   - Hover effects suaves

2. **Columna de Contacto**
   - Iconos de email (📧) y teléfono (📱)
   - Diseño compacto y organizado
   - Truncado de emails largos

3. **Columna de Adjuntos**
   - Botones con badges de color azul
   - Icono de archivo + nombre truncado
   - Icono de descarga visible al hacer hover
   - Badge "No disponible" para referidos sin documentos
   - Diseño:
     ```jsx
     <button className="inline-flex items-center gap-2 px-2 py-1 text-xs
                       font-medium text-blue-600 bg-blue-50
                       hover:bg-blue-100 rounded-md transition-colors">
       <FileText size={14} />
       <span className="truncate">{doc.nombre}</span>
       <Download size={12} className="opacity-0 group-hover:opacity-100" />
     </button>
     ```

4. **Columna de Acciones con Iconos**
   - Reemplazo de botones de texto por iconos
   - Iconos únicos y semánticos:
     - 👁️ **Eye**: Ver detalle (gris)
     - ⏰ **Clock**: Cambiar a PENDIENTE (amarillo)
     - 🔍 **Search**: Cambiar a EN_REVISION (azul)
     - 📞 **Phone**: Cambiar a CONTACTADO (morado)
     - ❌ **XCircle**: Cambiar a RECHAZADO (rojo)
     - ✅ **CheckCircle**: Cambiar a APROBADO (verde)
   - Colores semánticos por estado
   - Tooltips informativos
   - Efectos de hover suaves

5. **Modo Oscuro**
   - Soporte completo dark mode en toda la tabla
   - Colores adaptativos para cada tema

6. **Estado Vacío**
   - Icono grande de archivo
   - Mensaje centrado elegante

---

## 📁 Archivos Modificados

### Backend
1. `backend/src/middleware/auth.js` - Soporte para token en query string
2. `backend/src/middleware/upload.js` - Tipos de archivo permitidos ampliados
3. `backend/src/controllers/adjuntos.controller.js` - Función de descarga y estructura S3
4. `backend/src/controllers/referidos.controller.js` - Inclusión de adjuntos en listado
5. `backend/src/routes/index.js` - Corrección de anidamiento de rutas
6. `backend/src/routes/adjuntos.routes.js` - Ruta de descarga añadida
7. `backend/src/routes/referidos.routes.js` - Anidamiento de rutas de adjuntos
8. `backend/src/routes/gmail.routes.js` - Callback público
9. `backend/src/services/s3Service.js` - Nueva estructura de carpetas por RUT

### Frontend
1. `frontend/vite.config.js` - Puerto fijo configurado
2. `frontend/src/components/UploadSection.jsx` - Función de descarga simplificada
3. `frontend/src/services/referidos.js` - Método deleteAdjunto agregado
4. `frontend/src/pages/ReferidosPage.jsx` - Rediseño visual completo

---

## 🎨 Mejoras de UX/UI

### Antes vs Después

#### Adjuntos
- **Antes**: No visible en lista, solo al entrar al detalle
- **Después**:
  - Visible directamente en la tabla
  - Botones de descarga directa
  - Badges de "No disponible" claros
  - Iconos animados al hover

#### Acciones
- **Antes**: Botones grandes con texto completo
- **Después**:
  - Iconos compactos y semánticos
  - Colores que indican el tipo de acción
  - Tooltips explicativos
  - Más espacio en la tabla

#### Tabla General
- **Antes**: Diseño básico sin jerarquía visual
- **Después**:
  - Encabezados distinguidos con fondo
  - Espaciado profesional
  - Efectos de hover sutiles
  - Mejor contraste y legibilidad

---

## 🔐 Mejoras de Seguridad

1. **Autenticación en Descargas**
   - Token JWT requerido en todas las descargas
   - Soporte para token en query string (necesario para window.open)
   - URLs de S3 firmadas con expiración de 5 minutos

2. **Validación de Tipos de Archivo**
   - Whitelist de MIME types permitidos
   - Sanitización de nombres de archivo

---

## 📊 Estructura de Datos

### Modelo Documento
```javascript
{
  id: number,
  nombre: string,
  ruta: string,        // Ruta local o S3 key
  s3Key: string,       // Key de S3 (si aplica)
  mimetype: string,
  size: number,
  referidoId: number
}
```

### S3 Key Format
```
referidos/{RUT}/{referidoId}/documento/{timestamp}_{filename}
```
Ejemplo: `referidos/123456789/42/documento/1732567890_curriculum.pdf`

---

## 🐛 Problemas Conocidos Resueltos

1. ✅ Puerto del frontend cambiaba entre reinicios
2. ✅ Error 404 al subir documentos
3. ✅ Error 500 con archivos .doc y .docx
4. ✅ Callback de Gmail OAuth causaba error 401
5. ✅ Iconos duplicados en columna de acciones
6. ✅ Documentos no visibles en lista de referidos

---

## 🚀 Próximos Pasos Sugeridos

1. **Validación de Tamaño de Archivo**
   - Implementar límite por tipo de archivo
   - Mostrar progreso de carga para archivos grandes

2. **Previsualización de Documentos**
   - Modal con preview para PDFs e imágenes
   - Evitar descarga innecesaria

3. **Compresión de Imágenes**
   - Optimización automática al subir
   - Reducción de costos de almacenamiento S3

4. **Búsqueda por Contenido de Archivos**
   - OCR para documentos escaneados
   - Indexación de contenido textual

5. **Notificaciones**
   - Email cuando se sube un documento
   - Notificación cuando cambia el estado

---

## 📝 Notas Técnicas

### AWS S3 Configuration
- **Bucket**: `tracker-referidos`
- **Region**: `sa-east-1`
- **IAM Users**: `avillarroel`, `fileeco`
- **Permisos necesarios**: `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket`

### Tipos MIME Soportados
- `application/pdf` - PDF
- `image/png` - PNG
- `image/jpeg` - JPEG/JPG
- `image/jpg` - JPG
- `application/msword` - DOC
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - DOCX

### Límites
- **Tamaño máximo por archivo**: 10MB
- **Archivos por upload**: 10
- **Expiración URL firmada**: 5 minutos

---

## 👥 Créditos

**Desarrollado por**: Claude Code (Anthropic)
**Colaborador**: Alejandro Villarroel (@avillarroel)
**Fecha**: 25 de Noviembre de 2025
**Proyecto**: Sistema de Tracking de Referidos - ECORA

---

## 📌 Resumen Ejecutivo

En esta sesión se completó exitosamente:

- ✅ **4 bugs críticos corregidos** (puerto, rutas, tipos de archivo, OAuth)
- ✅ **3 nuevas funcionalidades** (descarga, S3 organizado, visualización)
- ✅ **Rediseño visual completo** de la tabla de referidos
- ✅ **14 archivos modificados** entre frontend y backend
- ✅ **Mejoras de UX/UI** significativas
- ✅ **Sistema de adjuntos completamente funcional**

El sistema ahora permite subir, almacenar, organizar y descargar documentos de manera eficiente y segura, con una interfaz moderna y profesional.
