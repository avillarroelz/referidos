-- Vincula una postulación con el usuario externo que la creó (postulanteUserId).
-- Idempotente: se puede ejecutar varias veces sin error.

ALTER TABLE referidos
  ADD COLUMN IF NOT EXISTS postulante_user_id INTEGER REFERENCES usuarios(id);

CREATE INDEX IF NOT EXISTS referidos_postulante_user_id_idx
  ON referidos (postulante_user_id);
