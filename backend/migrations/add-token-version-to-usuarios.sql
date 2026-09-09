-- Migración: contador de versión de token para revocar sesiones
-- Fecha: 2026-09-09
--
-- Hasta ahora una sesión no se podía revocar: logout solo borraba la cookie del
-- navegador, y changePassword limpiaba las cookies de quien cambiaba la clave
-- pero no invalidaba nada. Un refresh token copiado seguía sirviendo 7 días, y
-- quien cambiaba su contraseña creyendo que expulsaba a un intruso no expulsaba
-- a nadie.
--
-- El contador viaja dentro del JWT y se compara al renovar (refresh). Basta con
-- incrementarlo para que todo token emitido antes deje de valer.
--
-- DEFAULT 0 y sin backfill: cubre a los usuarios existentes sin recorrer la
-- tabla. Los tokens ya emitidos no llevan el campo; se tratan como versión 0,
-- así que siguen siendo válidos hasta su vencimiento natural y nadie queda
-- desconectado por el despliegue.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='usuarios' AND column_name='token_version') THEN
        ALTER TABLE usuarios ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;
