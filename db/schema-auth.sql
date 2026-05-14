-- Auth tables for Visor Productividad
-- Run in pgAdmin connected to the target database

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'user')),
  sede text,
  allowed_lines text[],
  allowed_subdashboards text[],
  special_roles text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  last_login_ip inet,
  CONSTRAINT app_users_user_sede_required
    CHECK (role <> 'user' OR (sede IS NOT NULL AND btrim(sede) <> ''))
);

CREATE TABLE IF NOT EXISTS app_user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent text
);

CREATE TABLE IF NOT EXISTS app_user_login_logs (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  ip inet,
  user_agent text
);

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_user_id
  ON app_user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_app_user_sessions_expires
  ON app_user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_app_user_login_logs_user_time
  ON app_user_login_logs(user_id, logged_at DESC);

CREATE TABLE IF NOT EXISTS rotacion_cero_item_estado (
  sede_id text NOT NULL,
  item text NOT NULL,
  context text NOT NULL DEFAULT 'cero' CHECK (context IN ('cero', 'restock')),
  estado text NOT NULL CHECK (
    estado IN ('sin_verificar', 'seguimiento', 'surtido')
  ),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (sede_id, item, context)
);

CREATE INDEX IF NOT EXISTS idx_rotacion_cero_item_estado_updated
  ON rotacion_cero_item_estado (updated_at DESC);

CREATE TABLE IF NOT EXISTS rotacion_cero_item_estado_audit (
  id bigserial PRIMARY KEY,
  sede_id text NOT NULL,
  item text NOT NULL,
  context text NOT NULL DEFAULT 'cero' CHECK (context IN ('cero', 'restock')),
  estado_anterior text NULL,
  estado_nuevo text NOT NULL CHECK (
    estado_nuevo IN ('sin_verificar', 'seguimiento', 'surtido')
  ),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rotacion_cero_audit_sede_changed
  ON rotacion_cero_item_estado_audit (sede_id, changed_at DESC);
