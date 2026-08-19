-- Firma al finalizar y fotos de evidencia (P / NC).

ALTER TABLE checklist_run
  ADD COLUMN IF NOT EXISTS signature_png text;

CREATE TABLE IF NOT EXISTS checklist_run_evidence (
  run_id uuid NOT NULL REFERENCES checklist_run (id) ON DELETE CASCADE,
  item_key text NOT NULL,
  foto_base64 text NOT NULL,
  mime text NOT NULL DEFAULT 'image/jpeg',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, item_key)
);

CREATE INDEX IF NOT EXISTS checklist_run_evidence_run_idx
  ON checklist_run_evidence (run_id);

COMMENT ON TABLE checklist_run_evidence IS
  'Foto obligatoria por ítem cuando la respuesta es P o NC.';
COMMENT ON COLUMN checklist_run.signature_png IS
  'Firma PNG/JPEG en base64 (data URL o payload) al finalizar el intento.';
