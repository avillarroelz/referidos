-- Permite transiciones de estado iniciadas por sistemas externos (integración)
-- sin usuario actor: actor_user_id pasa a ser nullable.
-- Idempotente: DROP NOT NULL no falla si la columna ya es nullable.
ALTER TABLE estado_historial ALTER COLUMN actor_user_id DROP NOT NULL;
