-- Intentos de checklist con ventana fija de 20 minutos.
-- Si vence, solo un admin puede volver a habilitar el intento.

CREATE TABLE IF NOT EXISTS checklist_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
  checklist_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL,
  completed_at timestamptz,
  expired_at timestamptz,
  reopened_by uuid REFERENCES app_users (id) ON DELETE SET NULL,
  reopened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_run_user_checklist_started_idx
  ON checklist_run (user_id, checklist_id, started_at DESC);

CREATE INDEX IF NOT EXISTS checklist_run_status_deadline_idx
  ON checklist_run (status, deadline_at);

COMMENT ON TABLE checklist_run IS
  'Intento de checklist: 20 minutos exactos desde started_at; vencido solo lo reabre un admin.';
