-- Bitacora de cambios admin sobre usuarios + intentos de login fallidos.
-- Aplicar en GCP/local: node scripts/apply-migration-file.mjs db/migrations/20260715_user_audit_trail.sql

CREATE TABLE IF NOT EXISTS app_user_admin_audit (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  actor_username text,
  target_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  target_username text NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'password_reset')),
  before_state jsonb,
  after_state jsonb,
  changed_fields text[] NOT NULL DEFAULT '{}',
  actor_ip text,
  actor_user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_user_admin_audit_target_time
  ON app_user_admin_audit (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_admin_audit_actor_time
  ON app_user_admin_audit (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_admin_audit_created
  ON app_user_admin_audit (created_at DESC);

COMMENT ON TABLE app_user_admin_audit IS
  'Auditoria de mutaciones admin sobre app_users (permisos, estado, password reset).';

-- Solo fallos: los exitosos siguen en app_user_login_logs.
CREATE TABLE IF NOT EXISTS app_user_login_attempt_log (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  failure_reason text NOT NULL CHECK (
    failure_reason IN (
      'unknown_user',
      'bad_password',
      'inactive',
      'rate_limited',
      'other'
    )
  ),
  logged_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_app_user_login_attempt_time
  ON app_user_login_attempt_log (logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_login_attempt_username_time
  ON app_user_login_attempt_log (lower(username), logged_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_user_login_attempt_user_time
  ON app_user_login_attempt_log (user_id, logged_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE app_user_login_attempt_log IS
  'Intentos de login fallidos (credenciales, inactivo, rate limit). IP ya audit-hashed si aplica.';
