-- Migration: optional per-user subdashboard restrictions
ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS allowed_subdashboards text[];

UPDATE app_users
SET allowed_subdashboards = NULL
WHERE allowed_subdashboards IS NOT NULL
  AND COALESCE(array_length(allowed_subdashboards, 1), 0) = 0;
