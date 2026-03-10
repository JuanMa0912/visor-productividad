-- Migration: optional per-user dashboard restrictions via app_users.allowed_dashboards

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS allowed_dashboards text[];

-- Normalize empty arrays to NULL (NULL means "todos los tableros").
UPDATE app_users
SET allowed_dashboards = NULL
WHERE allowed_dashboards IS NOT NULL
  AND COALESCE(array_length(allowed_dashboards, 1), 0) = 0;

