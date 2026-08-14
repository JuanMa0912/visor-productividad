-- Migration: maestro comercial de terceros/proveedores del POS
--
-- Origen: public.terceros en mercamio / mtodo / bogota (192.168.35.217).
-- Destino: UNA tabla con empresa en la clave (no 3 tablas).
-- ETL: scripts/etl/proveedores/etl_proveedor_tercero.py
-- Sync GCP: scripts/etl/sync-local-to-gcp.sh (MODE=full, catalogo sin fecha).
--
-- ESTO NO REEMPLAZA proveedor_pos_catalogo (criterios_itm_1 / etiqueta del item,
-- p.ej. MERCAMIO FRUVER). Aqui vive la lista comercial real (codigo + sucursal + NIT)
-- que usa la OC (id_terc / id_suc_terc).
--
-- Default del ETL: solo ind_pro='1' (proveedores). Clientes/empleados no entran.
-- Filas que salen del POS se marcan activo=false; no se borran.

CREATE TABLE IF NOT EXISTS proveedor_tercero (
  empresa text NOT NULL,                 -- mercamio | mtodo | bogota
  codigo text NOT NULL,                  -- terceros.codigo (SIESA CHAR, ya trim)
  sucursal text NOT NULL DEFAULT '00',   -- terceros.sucursal; '' del POS -> '00'
  nombre text,
  nit text,                              -- sin centinela 99999999
  nit_dv text,
  tipo_tercero text,
  tipo_identifica text,
  ind_pro text,
  ind_cli text,
  ind_empl text,
  estado text,                           -- crudo del POS; no inferimos semantica
  email text,
  telefono text,
  ciudad text,
  direccion text,
  establecimiento text,
  pro_clase text,
  pro_estado text,
  pro_cond_pago text,
  pro_contacto text,
  fecha_creacion text,                   -- YYYYMMDD
  fecha_ult_compra text,                 -- YYYYMMDD (p_fec_ult_compra)
  compras_brutas numeric(20, 2),
  nro_compras integer,
  activo boolean NOT NULL DEFAULT true,
  primera_carga timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, codigo, sucursal)
);

CREATE INDEX IF NOT EXISTS proveedor_tercero_idx_nit
ON proveedor_tercero (nit)
WHERE nit IS NOT NULL;

CREATE INDEX IF NOT EXISTS proveedor_tercero_idx_nombre
ON proveedor_tercero (nombre);

CREATE INDEX IF NOT EXISTS proveedor_tercero_idx_empresa_activo
ON proveedor_tercero (empresa, activo)
WHERE activo;
