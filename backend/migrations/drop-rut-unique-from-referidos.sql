-- Permitir que la misma persona (mismo RUT) postule a varios cargos.
-- 1) Quita cualquier constraint UNIQUE sobre la columna `rut` en `referidos`.
-- 2) Crea un índice NO único para conservar rendimiento de búsquedas por RUT.

DO $$
DECLARE
    cname TEXT;
BEGIN
    FOR cname IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'referidos'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) ILIKE '%(rut)%'
    LOOP
        EXECUTE format('ALTER TABLE referidos DROP CONSTRAINT %I', cname);
        RAISE NOTICE 'Dropped unique constraint: %', cname;
    END LOOP;
END $$;

-- También elimina índices únicos sobre `rut` (algunos drivers crean indices y no constraints)
DO $$
DECLARE
    iname TEXT;
BEGIN
    FOR iname IN
        SELECT i.indexname
        FROM pg_indexes i
        JOIN pg_index pi ON pi.indexrelid = (i.schemaname || '.' || i.indexname)::regclass
        WHERE i.tablename = 'referidos'
          AND pi.indisunique = true
          AND i.indexdef ILIKE '%(rut)%'
          AND i.indexname NOT IN (
              SELECT conname FROM pg_constraint
              WHERE conrelid = 'referidos'::regclass
          )
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I', iname);
        RAISE NOTICE 'Dropped unique index: %', iname;
    END LOOP;
END $$;

-- Índice no único para búsquedas rápidas por RUT
CREATE INDEX IF NOT EXISTS referidos_rut_idx ON referidos (rut);
