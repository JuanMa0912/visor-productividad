-- Separa estado de surtido/seguimiento entre vista "cero rotacion" y vista restock (S/R/N).

ALTER TABLE rotacion_cero_item_estado
  ADD COLUMN IF NOT EXISTS context text NOT NULL DEFAULT 'cero';

UPDATE rotacion_cero_item_estado
SET context = 'cero'
WHERE context IS NULL OR trim(context) = '';

ALTER TABLE rotacion_cero_item_estado
  DROP CONSTRAINT IF EXISTS rotacion_cero_item_estado_context_check;

ALTER TABLE rotacion_cero_item_estado
  ADD CONSTRAINT rotacion_cero_item_estado_context_check
  CHECK (context IN ('cero', 'restock'));

ALTER TABLE rotacion_cero_item_estado
  DROP CONSTRAINT IF EXISTS rotacion_cero_item_estado_pkey;

ALTER TABLE rotacion_cero_item_estado
  ADD PRIMARY KEY (sede_id, item, context);
