-- Migration: switch auth to username-only
-- Run once after db/schema-auth.sql

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username text;

-- If there are existing rows, preserve email into username
UPDATE app_users
SET username = COALESCE(username, email)
WHERE username IS NULL;

-- Enforce uniqueness + not null
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_users_username_key'
  ) THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_username_key UNIQUE (username);
  END IF;
END $$;

ALTER TABLE app_users ALTER COLUMN username SET NOT NULL;

-- Drop email and name columns if they exist
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'app_users'::regclass
    AND contype = 'u'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute WHERE attrelid = 'app_users'::regclass AND attname = 'email')
    ];

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app_users DROP CONSTRAINT %I', constraint_name);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'email'
  ) THEN
    ALTER TABLE app_users DROP COLUMN email;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'name'
  ) THEN
    ALTER TABLE app_users DROP COLUMN name;
  END IF;
END $$;
