-- Migración: consulta a black (lista de no recontratación) al ingresar personas
-- Fecha: 2026-11-11
--
-- Al ingresar una persona (ingreso interno, importación de Gmail, postulación o
-- formulario público) se consulta su RUT a black. Si black no responde, se usa un
-- respaldo local: las huellas HMAC-SHA256 de los RUT bloqueados, descargadas
-- desde black cada hora.
--
-- 1) lista_bloqueo_huellas: solo la huella (hex de 64). No guarda RUT, nombre ni
--    motivo, y no se puede revertir sin la clave de huella (BLACK_HUELLA_KEY).
--    Ley 21.719, art. 3 letra c (minimización). El contenido lo reemplaza la
--    aplicación en cada refresco, así que no necesita índices adicionales.
-- 2) referidos.en_lista_bloqueo: marca de control interno para las postulaciones
--    que se aceptan pero coinciden con la lista. Solo la ven RRHH, JefeRRHH y ADMIN.
--
-- Idempotente: se puede correr más de una vez. Hay que correrla ANTES de
-- desplegar la imagen que usa la tabla y la columna.

CREATE TABLE IF NOT EXISTS lista_bloqueo_huellas (
    huella      VARCHAR(64)  PRIMARY KEY,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT lista_bloqueo_huellas_formato_chk
        CHECK (huella ~ '^[0-9a-f]{64}$')
);

ALTER TABLE referidos ADD COLUMN IF NOT EXISTS en_lista_bloqueo BOOLEAN NOT NULL DEFAULT false;
