-- Migration: snapshot de ordenes de compra (tablero OC)
--
-- Alimentado por scripts/etl/orden-compra/etl_orden_compra.py (POS 217 -> produXdia 232)
-- y replicado a GCP por scripts/etl/sync-local-to-gcp.sh (MODE=snapshot: reemplazo completo).
--
-- ORIGEN: public.cmmovimiento_ocompra en mercamio / mtodo / bogota (192.168.35.217).
-- Grano CABECERA (una fila por OC), no linea. cantidad vs cantidad_ent van sumadas.
-- Detalle por item queda fuera a proposito; si el tablero lo pide, va en una segunda tabla.
--
-- VENTANA DEL SNAPSHOT (no es un hecho diario infinito):
--   * todas las OC CONFIRMADO (ind_estado='1'), sin limite de fecha
--   * mas cualquier estado con fecha_dcto o fecha_conf en los ultimos N dias (default 60)
-- Tipos: OC comercial, FR fruver, OM mercaderista, OS servicio al cliente.
--
-- SLA DE 7 DIAS: NO se persiste. El tablero calcula fecha_dcto + 7. fecha_entrega es la
-- promesa del POS (en fruver suele ser +1/+2, no +7). La confirmacion del sistema es
-- usuario_conf / fecha_conf / hora_conf.

CREATE TABLE IF NOT EXISTS orden_compra (
  id bigserial PRIMARY KEY,
  empresa text NOT NULL,                       -- mercamio | mtodo | bogota
  id_co text NOT NULL,                         -- centro de operacion POS (001, 002, ...)
  sede text,                                   -- resuelto contra ventas_item_sede_map (puede ser NULL)
  tipdoc text NOT NULL,                        -- OC | FR | OM | OS
  tipdoc_nom text NOT NULL,                    -- etiqueta estable del ETL, no del POS
  documento_oc text NOT NULL,
  fecha_dcto text NOT NULL,                    -- YYYYMMDD, cuando se hizo la OC
  fecha_entrega text,                          -- YYYYMMDD, promesa POS (puede ser NULL)
  id_terc text,                                -- codigo tercero POS
  id_suc_terc text,                            -- sucursal del tercero en la OC
  terc_nombre text,
  terc_nit text,
  ind_estado text NOT NULL,                    -- 0 PENDIENTE | 1 CONFIRMADO | 2 CUMPLIDO
  estado_nom text,
  usuario_ing text,
  usuario_conf text,                           -- confirmacion del sistema
  fecha_conf text,                             -- YYYYMMDD
  hora_conf text,                              -- HHMM
  comprador_nom text,
  n_lineas integer NOT NULL DEFAULT 0,
  n_items integer NOT NULL DEFAULT 0,
  cantidad numeric(18,4) NOT NULL DEFAULT 0,       -- SUM(cmmovimiento_ocompra.cantidad)
  cantidad_ent numeric(18,4) NOT NULL DEFAULT 0,   -- SUM(cantidad_ent): lo que ya llego
  tot_bruto numeric(18,4) NOT NULL DEFAULT 0,
  tot_venta numeric(18,4) NOT NULL DEFAULT 0,
  loaded_at timestamptz NOT NULL DEFAULT now()
);

-- Clave natural plana: el upsert/snapshot de sync-local-to-gcp.sh usa ON CONFLICT (KEY).
CREATE UNIQUE INDEX IF NOT EXISTS orden_compra_uq_natural
ON orden_compra (empresa, id_co, tipdoc, documento_oc);

CREATE INDEX IF NOT EXISTS orden_compra_idx_estado_fecha
ON orden_compra (empresa, ind_estado, fecha_dcto);

CREATE INDEX IF NOT EXISTS orden_compra_idx_fecha_entrega
ON orden_compra (fecha_entrega)
WHERE fecha_entrega IS NOT NULL;

CREATE INDEX IF NOT EXISTS orden_compra_idx_terc
ON orden_compra (empresa, id_terc);

CREATE INDEX IF NOT EXISTS orden_compra_idx_sede
ON orden_compra (sede, fecha_dcto);
