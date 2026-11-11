-- Migración: registro de correos de Gmail ya revisados por RRHH
-- Fecha: 2026-11-10
--
-- Cada análisis de la casilla de reclutamiento volvía a listar los mismos
-- correos: RRHH tenía que reconocer a mano cuáles ya había importado o descartado.
-- Esta tabla anota, por messageId de Gmail, qué se hizo con cada correo
-- (importado | descartado) para excluirlo del análisis siguiente y permitir
-- recuperar un descartado desde el historial.
--
-- Ley 21.719, art. 3 letra c (minimización): solo se guarda lo necesario para
-- reconocer el correo (id, remitente, asunto, estado, quién y cuándo). No se
-- guarda texto del CV ni respuestas de la IA.
--
-- Idempotente: se puede correr más de una vez. Hay que correrla ANTES de
-- desplegar la imagen que usa la tabla.

CREATE TABLE IF NOT EXISTS gmail_correos_revisados (
    id                       SERIAL PRIMARY KEY,
    gmail_message_id         VARCHAR(100) NOT NULL UNIQUE,
    estado                   VARCHAR(20)  NOT NULL,
    -- SET NULL: borrar la ficha (derecho de supresión) no debe borrar la marca
    -- de que el correo ya se revisó, o reaparecería en el análisis.
    referido_id              INTEGER      REFERENCES referidos(id) ON DELETE SET NULL,
    remitente                VARCHAR(255),
    asunto                   VARCHAR(255),
    revisado_por_usuario_id  INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT gmail_correos_revisados_estado_chk
        CHECK (estado IN ('importado', 'descartado'))
);

-- El historial se lista por estado y del más reciente al más antiguo.
CREATE INDEX IF NOT EXISTS idx_gmail_correos_revisados_estado
    ON gmail_correos_revisados (estado, created_at DESC);

-- Backfill: los referidos ya importados desde Gmail cuentan como revisados.
-- Los importados antes de add-gmail-message-id-to-referidos.sql no tienen
-- messageId y no se pueden recuperar.
INSERT INTO gmail_correos_revisados (gmail_message_id, estado, referido_id, revisado_por_usuario_id, created_at, updated_at)
SELECT r.gmail_message_id, 'importado', r.id, r.creado_por_usuario_id, r.created_at, now()
FROM referidos r
WHERE r.gmail_message_id IS NOT NULL
ON CONFLICT (gmail_message_id) DO NOTHING;
