-- Migración: Agregar columna s3_key a la tabla documentos
-- Para almacenar la ruta del archivo en AWS S3

-- Agregar columna s3_key (nullable, ya que archivos existentes son locales)
ALTER TABLE documentos
ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500);

-- Agregar índice para búsquedas por s3_key
CREATE INDEX IF NOT EXISTS idx_documentos_s3_key ON documentos(s3_key);

-- Comentario en la columna
COMMENT ON COLUMN documentos.s3_key IS 'Ruta del archivo en AWS S3 bucket';
