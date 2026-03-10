-- Migration: explicit user-branch link via app_users.sede

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS sede text;

-- Backfill known sede_* usernames to the canonical sede names.
UPDATE app_users
SET sede = CASE
  WHEN lower(username) = 'sede_calle5ta' THEN 'Calle 5ta'
  WHEN lower(username) = 'sede_la39' THEN 'La 39'
  WHEN lower(username) = 'sede_plazanorte' THEN 'Plaza Norte'
  WHEN lower(username) = 'sede_ciudadjardin' THEN 'Ciudad Jardin'
  WHEN lower(username) = 'sede_centrosur' THEN 'Centro Sur'
  WHEN lower(username) = 'sede_palmira' THEN 'Palmira'
  WHEN lower(username) = 'sede_floresta' THEN 'Floresta'
  WHEN lower(username) = 'sede_floralia' THEN 'Floralia'
  WHEN lower(username) = 'sede_guaduales' THEN 'Guaduales'
  WHEN lower(username) = 'sede_bogota' THEN 'Bogota'
  WHEN lower(username) = 'sede_chia' THEN 'Chia'
  ELSE sede
END
WHERE (sede IS NULL OR btrim(sede) = '')
  AND lower(username) LIKE 'sede_%';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'app_users_user_sede_required'
  ) THEN
    ALTER TABLE app_users
    ADD CONSTRAINT app_users_user_sede_required
      CHECK (role <> 'user' OR (sede IS NOT NULL AND btrim(sede) <> ''));
  END IF;
END $$;
