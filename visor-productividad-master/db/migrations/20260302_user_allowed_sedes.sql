-- Migration: optional per-user branch restrictions via app_users.allowed_sedes

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS allowed_sedes jsonb;

UPDATE app_users
SET allowed_sedes = NULL
WHERE allowed_sedes = '[]'::jsonb;

