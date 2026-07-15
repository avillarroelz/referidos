-- Tabla de reportes de la pantalla principal: bugs, correcciones y recomendaciones.
-- Las imágenes adjuntas viven en S3 (carpeta feedback/); aquí solo su metadata (imagenes JSONB).
-- Idempotente: se puede ejecutar varias veces sin error.

CREATE TABLE IF NOT EXISTS feedbacks (
  id              SERIAL PRIMARY KEY,
  tipo            VARCHAR(20)  NOT NULL DEFAULT 'BUG',
  titulo          VARCHAR(150),
  mensaje         TEXT         NOT NULL,
  url             VARCHAR(255),
  estado          VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE',
  autor_user_id   INTEGER      REFERENCES usuarios(id),
  imagenes        JSONB        DEFAULT '[]'::jsonb,
  nota_resolucion TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedbacks_estado_idx
  ON feedbacks (estado);

CREATE INDEX IF NOT EXISTS feedbacks_autor_user_id_idx
  ON feedbacks (autor_user_id);
