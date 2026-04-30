-- Renombra valores de estado para cero rotacion:
-- sin_revisar -> sin_verificar
-- r_inventario -> surtido

UPDATE rotacion_cero_item_estado
SET estado = 'sin_verificar'
WHERE estado = 'sin_revisar';

UPDATE rotacion_cero_item_estado
SET estado = 'surtido'
WHERE estado = 'r_inventario';

ALTER TABLE rotacion_cero_item_estado
DROP CONSTRAINT IF EXISTS rotacion_cero_item_estado_estado_check;

ALTER TABLE rotacion_cero_item_estado
ADD CONSTRAINT rotacion_cero_item_estado_estado_check
CHECK (estado IN ('sin_verificar', 'seguimiento', 'surtido'));
