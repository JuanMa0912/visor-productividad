-- Migration: optional per-user line restrictions via app_users.allowed_lines

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS allowed_lines text[];

-- Normalize empty arrays to NULL (NULL means "todas las lineas").
UPDATE app_users
SET allowed_lines = NULL
WHERE allowed_lines IS NOT NULL
  AND COALESCE(array_length(allowed_lines, 1), 0) = 0;
