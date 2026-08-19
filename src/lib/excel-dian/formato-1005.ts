import type { PoolClient } from "pg";
import type { AnexoRow } from "./formato-1006";

/**
 * Formato DIAN 1005 - IVA DESCONTABLE. Por tercero, 3 columnas de valor:
 *   I = Impuesto descontable (IVA directo compras + parte descontable del comun)
 *   J = IVA por devoluciones en ventas (cuentas 2408103x)
 *   K = IVA tratado como mayor valor del costo/gasto Art.490 (prorrateo)
 *
 * PRORRATEO: el IVA de operaciones comunes (24081500/502) se reparte segun un %.
 * El % se puede ingresar manual ($4, decimal 0..1); si es NULL se deriva de las
 * cuentas (24081590 / IVA comun). La columna J desglosa clientes de dev. venta
 * POS (notas), ajustando el genérico.
 *
 * Params: $1 = lapso inicio, $2 = lapso fin, $3 = id_emp, $4 = % prorrateo (0..1 | null).
 */
export const FORMATO_1005_COLUMNS = [
  { key: "Tipo Documento", header: "Tipo Documento" },
  { key: "Numero Identificacion", header: "Numero Identificacion" },
  { key: "DV", header: "DV" },
  { key: "Primer Apellido", header: "Primer Apellido" },
  { key: "Segundo Apellido", header: "Segundo Apellido" },
  { key: "Primer Nombre", header: "Primer Nombre" },
  { key: "Otros Nombres", header: "Otros Nombres" },
  { key: "Razon Social", header: "Razon Social" },
  { key: "Direccion", header: "Direccion" },
  { key: "Codigo Pais", header: "Codigo Pais" },
  { key: "Codigo Departamento", header: "Codigo Departamento" },
  { key: "Codigo Municipio", header: "Codigo Municipio" },
  { key: "Impuesto Descontable", header: "Impuesto Descontable" },
  { key: "IVA Dev en Ventas", header: "IVA Dev en Ventas" },
  { key: "IVA Mayor Valor Costo Art490", header: "IVA Mayor Valor Costo Art.490" },
] as const;

export const FORMATO_1005_VALUE_KEYS = [
  "Impuesto Descontable",
  "IVA Dev en Ventas",
  "IVA Mayor Valor Costo Art490",
];

const CTA_1005 = `
        ('24081010','D'),('24081012','D'),('24081013','D'),('24081014','D'),
        ('24081500','C'),('24081502','C'),
        ('24081030','J'),('24081032','J'),('24081033','J'),('24081034','J'),('24081039','J'),
        ('24081590','P')`;

const FORMATO_1005_QUERY = `
WITH cta (cuenta, rol) AS (VALUES ${CTA_1005}),
pct AS (
    SELECT COALESCE($4::numeric,
                CASE WHEN SUM(CASE WHEN cta.rol='C' THEN c.valor_deb - c.valor_cre ELSE 0 END) = 0 THEN 0
                     ELSE SUM(CASE WHEN cta.rol='P' THEN c.valor_cre - c.valor_deb ELSE 0 END)
                        / SUM(CASE WHEN cta.rol='C' THEN c.valor_deb - c.valor_cre ELSE 0 END) END) AS p
    FROM public.cgmovimiento_contable c JOIN cta ON TRIM(c.id_cuenta) = cta.cuenta
    WHERE c.id_emp = $3 AND c.lapso_doc BETWEEN $1 AND $2
),
mayor AS (
    SELECT TRIM(c.terc) AS id_terc,
        SUM(CASE WHEN cta.rol='D' THEN c.valor_deb - c.valor_cre ELSE 0 END) AS iva_directo,
        SUM(CASE WHEN cta.rol='C' THEN c.valor_deb - c.valor_cre ELSE 0 END) AS iva_comun,
        SUM(CASE WHEN cta.rol='J' THEN c.valor_deb - c.valor_cre ELSE 0 END) AS dev_ventas
    FROM public.cgmovimiento_contable c JOIN cta ON TRIM(c.id_cuenta) = cta.cuenta
    WHERE c.id_emp = $3 AND c.lapso_doc BETWEEN $1 AND $2 AND cta.rol IN ('D','C','J')
    GROUP BY TRIM(c.terc)
),
notas_pdv AS (
    SELECT DISTINCT TRIM(id_tipdoc_fc) AS codigo FROM public.cmmovimiento_pdv
    WHERE id_emp_fc=$3 AND lapso_doc BETWEEN $1 AND $2
      AND TRIM(id_tipdoc_fc) IN (SELECT TRIM(codigo) FROM public.tipos_documentos WHERE descripcion ILIKE '%NOTA%')
),
pdv_notas AS (
    SELECT TRIM(p.id_terc) AS id_terc,
        SUM(ABS(p.imp_netos - p.vlrimpcon1 - p.vlrimpcon2)) AS dev_pos
    FROM public.cmmovimiento_pdv p
    JOIN notas_pdv nt ON TRIM(p.id_tipdoc_fc)=nt.codigo
    WHERE p.id_emp_fc=$3 AND p.lapso_doc BETWEEN $1 AND $2
      AND TRIM(p.id_terc) NOT IN ('222222222222','VC')
    GROUP BY TRIM(p.id_terc)
    HAVING SUM(ABS(p.imp_netos - p.vlrimpcon1 - p.vlrimpcon2)) <> 0
),
pdv_notas_total AS (SELECT COALESCE(SUM(dev_pos),0) AS t FROM pdv_notas),
mayor_ajustado AS (
    SELECT m.id_terc,
        m.iva_directo + (1 - (SELECT p FROM pct)) * m.iva_comun AS descontable,
        m.dev_ventas AS dev_ventas,
        (SELECT p FROM pct) * m.iva_comun AS prorrateo
    FROM mayor m WHERE TRIM(m.id_terc) NOT IN ('222222222222','VC')
    UNION ALL
    SELECT '222222222222',
        SUM(m.iva_directo + (1 - (SELECT p FROM pct)) * m.iva_comun),
        SUM(m.dev_ventas) - (SELECT t FROM pdv_notas_total),
        SUM((SELECT p FROM pct) * m.iva_comun)
    FROM mayor m WHERE TRIM(m.id_terc) IN ('222222222222','VC')
    UNION ALL
    SELECT id_terc, 0, dev_pos, 0 FROM pdv_notas
),
valores AS (
    SELECT id_terc, SUM(descontable) AS descontable, SUM(dev_ventas) AS dev_ventas,
           SUM(prorrateo) AS prorrateo
    FROM mayor_ajustado GROUP BY id_terc
),
reporte AS (
SELECT
    CASE
        WHEN TRIM(v.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222') THEN '43'
        WHEN TRIM(t.tipo_identifica)='1' THEN '13'
        WHEN TRIM(t.tipo_identifica)='2' THEN '31'
        WHEN TRIM(t.tipo_identifica)='3' THEN '22'
        WHEN TRIM(t.tipo_identifica)='4' THEN '12'
        WHEN TRIM(t.tipo_identifica)='5' THEN '41'
        WHEN TRIM(t.tipo_identifica)='6' THEN '21'
        WHEN TRIM(t.tipo_identifica)='9' THEN '43'
        ELSE TRIM(t.tipo_identifica)
    END AS "Tipo Documento",
    CASE
        WHEN TRIM(v.id_terc) IN ('VC','222222222222') OR TRIM(t.codigo) IN ('VC') OR LTRIM(TRIM(t.nit),'0') IN ('VC')
        THEN '222222222222' ELSE LTRIM(TRIM(t.nit),'0')
    END AS "Numero Identificacion",
    CASE
        WHEN TRIM(v.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222')
        THEN '1' ELSE TRIM(t.nit_dv)
    END AS "DV",
    TRIM(t.apellido1) AS "Primer Apellido",
    TRIM(t.apellido2) AS "Segundo Apellido",
    SPLIT_PART(TRIM(t.nombres), ' ', 1) AS "Primer Nombre",
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '') AS "Otros Nombres",
    CASE
        WHEN TRIM(v.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222')
        THEN 'CONSUMIDOR FINAL' ELSE TRIM(t.descripcion)
    END AS "Razon Social",
    TRIM(t.direccion_1) AS "Direccion",
    CASE WHEN TRIM(t.pais_corresp)='770' THEN '169' ELSE TRIM(t.pais_corresp) END AS "Codigo Pais",
    TRIM(t.dpto_corresp) AS "Codigo Departamento",
    TRIM(t.ciudad_corresp) AS "Codigo Municipio",
    ROUND(v.descontable)::bigint AS "Impuesto Descontable",
    ROUND(v.dev_ventas)::bigint  AS "IVA Dev en Ventas",
    ROUND(v.prorrateo)::bigint    AS "IVA Mayor Valor Costo Art490"
FROM valores v
LEFT JOIN (
    SELECT DISTINCT ON (TRIM(codigo))
        TRIM(codigo) AS codigo, nit, nit_dv, tipo_identifica,
        apellido1, apellido2, nombres, descripcion, direccion_1,
        pais_corresp, dpto_corresp, ciudad_corresp
    FROM public.terceros WHERE sucursal='00'
    ORDER BY TRIM(codigo),
             (CASE WHEN TRIM(COALESCE(estado,''))='X' THEN 1 ELSE 0 END),
             (CASE WHEN TRIM(COALESCE(nit_dv,''))='' THEN 1 ELSE 0 END), ctid
) t ON t.codigo = TRIM(v.id_terc)
WHERE ROUND(v.descontable)::bigint <> 0 OR ROUND(v.dev_ventas)::bigint <> 0 OR ROUND(v.prorrateo)::bigint <> 0
)
SELECT
    MAX("Tipo Documento") AS "Tipo Documento", "Numero Identificacion", MAX("DV") AS "DV",
    MAX("Primer Apellido") AS "Primer Apellido", MAX("Segundo Apellido") AS "Segundo Apellido",
    MAX("Primer Nombre") AS "Primer Nombre", MAX("Otros Nombres") AS "Otros Nombres",
    MAX("Razon Social") AS "Razon Social", MAX("Direccion") AS "Direccion",
    MAX("Codigo Pais") AS "Codigo Pais", MAX("Codigo Departamento") AS "Codigo Departamento",
    MAX("Codigo Municipio") AS "Codigo Municipio",
    SUM("Impuesto Descontable") AS "Impuesto Descontable",
    SUM("IVA Dev en Ventas") AS "IVA Dev en Ventas",
    SUM("IVA Mayor Valor Costo Art490") AS "IVA Mayor Valor Costo Art490"
FROM reporte GROUP BY "Numero Identificacion" ORDER BY "Numero Identificacion"
`;

const CTA_1005_ANEXO = `
        ('24081010','D'),('24081012','D'),('24081013','D'),('24081014','D'),
        ('24081500','C'),('24081502','C'),
        ('24081030','J'),('24081032','J'),('24081033','J'),('24081034','J'),('24081039','J'),
        ('24081590','P')`;

const ANEXO_1005_QUERY = `
WITH cta (cuenta, rol) AS (VALUES ${CTA_1005_ANEXO})
SELECT cta.cuenta AS cuenta,
    COALESCE(MAX(TRIM(ct.descripcion)), '') AS nombre_cuenta,
    COALESCE(SUM(c.valor_deb), 0) AS suma_debitos,
    COALESCE(SUM(c.valor_cre), 0) AS suma_creditos,
    COALESCE(SUM(c.valor_deb - c.valor_cre), 0) AS suma_movimiento,
    cta.rol AS grupo
FROM cta
LEFT JOIN public.cgmovimiento_contable c
       ON TRIM(c.id_cuenta) = cta.cuenta AND c.id_emp = $3 AND c.lapso_doc BETWEEN $1 AND $2
LEFT JOIN public.cuentas_contab ct ON TRIM(ct.codigo) = cta.cuenta
GROUP BY cta.cuenta, cta.rol
HAVING COALESCE(SUM(c.valor_deb), 0) <> 0 OR COALESCE(SUM(c.valor_cre), 0) <> 0
ORDER BY cta.rol, cta.cuenta
`;

const toNum = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export const queryFormato1005 = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
  pctProrrateo: number | null,
) => {
  const result = await client.query(FORMATO_1005_QUERY, [
    startLapso,
    endLapso,
    idEmp,
    pctProrrateo,
  ]);
  return result.rows;
};

export const queryAnexo1005 = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
): Promise<AnexoRow[]> => {
  const result = await client.query(ANEXO_1005_QUERY, [startLapso, endLapso, idEmp]);
  return result.rows.map((r) => ({
    cuenta: String(r.cuenta ?? "").trim(),
    nombre_cuenta: String(r.nombre_cuenta ?? "").trim(),
    suma_debitos: toNum(r.suma_debitos),
    suma_creditos: toNum(r.suma_creditos),
    suma_movimiento: toNum(r.suma_movimiento),
    grupo: String(r.grupo ?? "").trim(),
  }));
};
