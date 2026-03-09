# 📧 Plantilla para Enviar Referidos por Correo

## Asunto sugerido:
```
REFERIDO: [Nombre del Candidato] - [Cargo]
```

## Cuerpo del correo:

```
Hola equipo de RRHH,

Les envío el siguiente referido para el cargo de [Cargo]:

**Datos del Candidato:**
- Nombre: [Nombre Completo]
- RUT: [12.345.678-9]
- Email: [correo@ejemplo.com]
- Teléfono: +56 9 1234 5678
- Cargo Postulado: [Nombre del Cargo]

**Observaciones:**
[Comentarios adicionales sobre el candidato, experiencia, etc.]

**Referido por:**
[Tu Nombre]

Saludos!
```

## Ejemplo Real:

```
Asunto: REFERIDO: Juan Pérez - Desarrollador Full Stack

Hola equipo de RRHH,

Les envío el siguiente referido para el cargo de Desarrollador Full Stack:

**Datos del Candidato:**
- Nombre: Juan Andrés Pérez González
- RUT: 18.234.567-K
- Email: juan.perez@gmail.com
- Teléfono: +56 9 8765 4321
- Cargo Postulado: Desarrollador Full Stack

**Observaciones:**
Trabajé con Juan en mi empresa anterior. Tiene 5 años de experiencia en React y Node.js.
Es muy proactivo y trabaja bien en equipo.

**Referido por:**
María González

Saludos!
```

## 📝 Notas Importantes:

1. **Asunto**: Debe contener la palabra "REFERIDO" para facilitar la búsqueda automática
2. **Formato**: Mantener las etiquetas en negritas (**Campo:**) para facilitar la extracción
3. **Email destino**: Enviar a rrhh@ecora.cl o al correo configurado
4. **RUT**: Formato chileno con puntos y guión (12.345.678-9)
5. **Teléfono**: Formato +56 9 XXXX XXXX

## 🔍 El sistema buscará automáticamente:
- Correos con "REFERIDO" en el asunto
- Correos no leídos (is:unread)
- Extraerá automáticamente: nombre, RUT, email, teléfono y cargo
