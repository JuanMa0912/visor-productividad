-- Migration: optional per-user extra roles via app_users.special_roles
-- Example: {'alex'}

ALTER TABLE app_users
ADD COLUMN IF NOT EXISTS special_roles text[];

UPDATE app_users
SET special_roles = NULL
WHERE special_roles IS NOT NULL
  AND COALESCE(array_length(special_roles, 1), 0) = 0;
