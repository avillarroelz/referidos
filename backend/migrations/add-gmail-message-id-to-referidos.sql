-- Migración: idempotencia del import de Gmail por messageId
-- Fecha: 2026-09-29
--
-- El import desde Gmail solo deduplicaba por rut o email. Si el cliente cortaba
-- la request por timeout, el backend seguía importando y el usuario reintentaba:
-- los referidos sin rut ni email quedaban duplicados, y dos requests
-- concurrentes duplicaban incluso con rut (el rut no es único, ver
-- drop-rut-unique-from-referidos.sql).
--
-- El messageId de Gmail identifica el correo de origen. El índice UNIQUE es
-- parcial: los referidos que no vienen de Gmail quedan con NULL y no compiten.
--
-- Sin backfill: los referidos importados antes de esta migración no tienen el
-- messageId guardado, así que re-importar uno de esos correos no se detecta.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='referidos' AND column_name='gmail_message_id') THEN
        ALTER TABLE referidos ADD COLUMN gmail_message_id VARCHAR(100);
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS referidos_gmail_message_id_unique
    ON referidos (gmail_message_id)
    WHERE gmail_message_id IS NOT NULL;
