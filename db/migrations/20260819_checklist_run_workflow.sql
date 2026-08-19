-- Flujo mensual encargado/revisor, puntaje y respuestas para cruce y panel.

ALTER TABLE checklist_run
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS empresa text,
  ADD COLUMN IF NOT EXISTS sede text,
  ADD COLUMN IF NOT EXISTS period_year integer,
  ADD COLUMN IF NOT EXISTS period_month integer,
  ADD COLUMN IF NOT EXISTS answers jsonb,
  ADD COLUMN IF NOT EXISTS score_pct numeric,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

ALTER TABLE checklist_run DROP CONSTRAINT IF EXISTS checklist_run_actor_role_check;
ALTER TABLE checklist_run
  ADD CONSTRAINT checklist_run_actor_role_check
  CHECK (actor_role IS NULL OR actor_role IN ('encargado', 'revisor'));

CREATE UNIQUE INDEX IF NOT EXISTS checklist_run_monthly_unique_idx
  ON checklist_run (
    checklist_id,
    lower(btrim(sede)),
    actor_role,
    period_year,
    period_month
  )
  WHERE status IN ('in_progress', 'completed', 'expired')
    AND sede IS NOT NULL
    AND btrim(sede) <> ''
    AND actor_role IS NOT NULL
    AND period_year IS NOT NULL
    AND period_month IS NOT NULL;

CREATE INDEX IF NOT EXISTS checklist_run_panel_idx
  ON checklist_run (period_year DESC, period_month DESC, sede, checklist_id);

COMMENT ON COLUMN checklist_run.actor_role IS
  'encargado = responsable de sede (1 vez al mes); revisor = auditoria aleatoria.';
