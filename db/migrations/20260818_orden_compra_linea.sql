-- Lineas de orden de compra (item + tercero real).
--
-- La cabecera `orden_compra` no trae id_item: por eso el tablero de costos
-- termina mostrando el criterio del item (p.ej. MERCAMIO FRUVER) y no a
-- quien realmente trajo la mercancia.
--
-- Origen: public.cmmovimiento_ocompra en 217 (misma fuente que la cabecera).
-- ETL: scripts/etl/orden-compra/etl_orden_compra.py
-- Sync GCP: --only orden_compra_linea (o junto con orden_compra).

CREATE TABLE IF NOT EXISTS orden_compra_linea (
  empresa text NOT NULL,
  id_co text NOT NULL,
  tipdoc text NOT NULL,
  documento_oc text NOT NULL,
  fecha_dcto text NOT NULL,
  id_item text NOT NULL,
  id_terc text NOT NULL DEFAULT '',
  id_suc_terc text,
  terc_nombre text,
  terc_nit text,
  cantidad numeric(18, 4) NOT NULL DEFAULT 0,
  cantidad_ent numeric(18, 4) NOT NULL DEFAULT 0,
  tot_bruto numeric(18, 4) NOT NULL DEFAULT 0,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, id_co, tipdoc, documento_oc, id_item, id_terc)
);

CREATE INDEX IF NOT EXISTS orden_compra_linea_idx_item_fecha
ON orden_compra_linea (empresa, id_item, fecha_dcto);

CREATE INDEX IF NOT EXISTS orden_compra_linea_idx_terc
ON orden_compra_linea (empresa, id_terc)
WHERE id_terc <> '';
