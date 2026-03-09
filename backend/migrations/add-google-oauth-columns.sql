-- Migración: Agregar columnas para Google OAuth
-- Fecha: 2025-11-24

-- Agregar columnas si no existen
DO $$
BEGIN
    -- google_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='usuarios' AND column_name='google_id') THEN
        ALTER TABLE usuarios ADD COLUMN google_id VARCHAR(255) UNIQUE;
    END IF;

    -- google_refresh_token
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='usuarios' AND column_name='google_refresh_token') THEN
        ALTER TABLE usuarios ADD COLUMN google_refresh_token TEXT;
    END IF;

    -- profile_picture
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='usuarios' AND column_name='profile_picture') THEN
        ALTER TABLE usuarios ADD COLUMN profile_picture VARCHAR(500);
    END IF;

    -- auth_provider (tipo ENUM)
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_usuarios_auth_provider') THEN
        CREATE TYPE enum_usuarios_auth_provider AS ENUM ('local', 'google');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='usuarios' AND column_name='auth_provider') THEN
        ALTER TABLE usuarios ADD COLUMN auth_provider enum_usuarios_auth_provider DEFAULT 'local' NOT NULL;
    END IF;

    -- Hacer password nullable (para usuarios de Google que no tienen password)
    ALTER TABLE usuarios ALTER COLUMN password DROP NOT NULL;

END $$;

-- Verificar columnas agregadas
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'usuarios'
AND column_name IN ('google_id', 'google_refresh_token', 'profile_picture', 'auth_provider', 'password')
ORDER BY column_name;
