import type { PoolClient } from "pg";

/**
 * Formato DIAN 1006 - IVA GENERADO. Por tercero, 3 columnas de valor:
 *   I = IVA generado (cuentas 240805 10/12/13/14/19/20/22/24)
 *   J = IVA recuperado en devoluciones de compras (240805 30/32/33/34/39)
 *   K = Impuesto al consumo
 *
 * Estructura mayor + PDV: desglosa el IVA generado de las ventas POS por cliente
 * (imp_netos - vlrimpcon1 - vlrimpcon2), ajustando el genérico. J y K se toman
 * del mayor. El impoconsumo (K) puede ingresarse manual ($4): si viene, va
 * completo al consumidor final; si es NULL, se usa el neto contable.
 *
 * Params: $1 = lapso inicio (YYYYMM), $2 = lapso fin, $3 = id_emp,
 *         $4 = impoconsumo manual (numeric|null).
 */
export const FORMATO_1006_COLUMNS = [
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
  { key: "IVA Generado", header: "IVA Generado" },
  { key: "IVA Recuperado Dev Compras", header: "IVA Recuperado Dev Compras" },
  { key: "Impuesto al Consumo", header: "Impuesto al Consumo" },
] as const;

export const FORMATO_1006_VALUE_KEYS = [
  "IVA Generado",
  "IVA Recuperado Dev Compras",
  "Impuesto al Consumo",
];

const CTA_1006 = `
        ('24080510','I','N'),('24080512','I','N'),('24080513','I','N'),('24080514','I','N'),
        ('24080519','I','N'),('24080520','I','N'),('24080522','I','N'),('24080524','I','N'),
        ('24080530','J','N'),('24080532','J','N'),('24080533','J','N'),('24080534','J','N'),('24080539','J','N'),
        ('24100101','K','GC'),('24100200','K','GC'),('24100175','K','DV')`;

const FORMATO_1006_QUERY = `
WITH cta (cuenta, col, modo) AS (VALUES ${CTA_1006}),
mayor AS (
    SELECT TRIM(c.terc) AS id_terc,
        SUM(CASE WHEN cta.col='I' THEN c.valor_cre - c.valor_deb ELSE 0 END) AS iva_generado,
        SUM(CASE WHEN cta.col='J' THEN c.valor_cre - c.valor_deb ELSE 0 END) AS dev_compras,
        SUM(CASE WHEN cta.col='K' AND cta.modo='GC' THEN c.valor_cre
                 WHEN cta.col='K' AND cta.modo='DV' THEN -c.valor_deb ELSE 0 END) AS impoconsumo
    FROM public.cgmovimiento_contable c
    JOIN cta ON TRIM(c.id_cuenta) = cta.cuenta
    WHERE c.id_emp = $3 AND c.lapso_doc BETWEEN $1 AND $2
    GROUP BY TRIM(c.terc)
),
notas_pdv AS (
    SELECT DISTINCT TRIM(id_tipdoc_fc) AS codigo FROM public.cmmovimiento_pdv
    WHERE id_emp_fc=$3 AND lapso_doc BETWEEN $1 AND $2
      AND TRIM(id_tipdoc_fc) IN (SELECT TRIM(codigo) FROM public.tipos_documentos WHERE descripcion ILIKE '%NOTA%')
),
pdv_ind AS (
    SELECT TRIM(p.id_terc) AS id_terc,
        SUM(CASE WHEN nt.codigo IS NULL THEN (p.imp_netos - p.vlrimpcon1 - p.vlrimpcon2)
                 ELSE -(ABS(p.imp_netos) - ABS(p.vlrimpcon1) - ABS(p.vlrimpcon2)) END) AS iva_pos
    FROM public.cmmovimiento_pdv p
    LEFT JOIN notas_pdv nt ON TRIM(p.id_tipdoc_fc)=nt.codigo
    WHERE p.id_emp_fc=$3 AND p.lapso_doc BETWEEN $1 AND $2
      AND TRIM(p.id_terc) NOT IN ('222222222222','VC')
    GROUP BY TRIM(p.id_terc)
    HAVING SUM(CASE WHEN nt.codigo IS NULL THEN (p.imp_netos - p.vlrimpcon1 - p.vlrimpcon2)
                    ELSE -(ABS(p.imp_netos) - ABS(p.vlrimpcon1) - ABS(p.vlrimpcon2)) END) <> 0
),
pdv_total AS (SELECT COALESCE(SUM(iva_pos),0) AS t FROM pdv_ind),
mayor_ajustado AS (
    SELECT id_terc, iva_generado, dev_compras,
        CASE WHEN $4::numeric IS NOT NULL THEN 0 ELSE impoconsumo END AS impoconsumo
    FROM mayor WHERE TRIM(id_terc) NOT IN ('222222222222','VC')
    UNION ALL
    SELECT '222222222222',
        COALESCE(SUM(iva_generado),0) - (SELECT t FROM pdv_total),
        COALESCE(SUM(dev_compras),0),
        CASE WHEN $4::numeric IS NOT NULL THEN $4::numeric ELSE COALESCE(SUM(impoconsumo),0) END
    FROM mayor WHERE TRIM(id_terc) IN ('222222222222','VC')
    UNION ALL
    SELECT id_terc, iva_pos, 0, 0 FROM pdv_ind
),
mayor2 AS (
    SELECT id_terc, SUM(iva_generado) AS iva_generado, SUM(dev_compras) AS dev_compras,
           SUM(impoconsumo) AS impoconsumo
    FROM mayor_ajustado GROUP BY id_terc
),
reporte AS (
SELECT
    CASE
        WHEN TRIM(m.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222') THEN '43'
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
        WHEN TRIM(m.id_terc) IN ('VC','222222222222') OR TRIM(t.codigo) IN ('VC') OR LTRIM(TRIM(t.nit),'0') IN ('VC')
        THEN '222222222222' ELSE LTRIM(TRIM(t.nit),'0')
    END AS "Numero Identificacion",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222')
        THEN '1' ELSE TRIM(t.nit_dv)
    END AS "DV",
    TRIM(t.apellido1) AS "Primer Apellido",
    TRIM(t.apellido2) AS "Segundo Apellido",
    SPLIT_PART(TRIM(t.nombres), ' ', 1) AS "Primer Nombre",
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '') AS "Otros Nombres",
    CASE
        WHEN TRIM(m.id_terc) IN ('VC','222222222222') OR LTRIM(TRIM(t.nit),'0') IN ('VC','222222222222')
        THEN 'CONSUMIDOR FINAL' ELSE TRIM(t.descripcion)
    END AS "Razon Social",
    TRIM(t.direccion_1) AS "Direccion",
    CASE WHEN TRIM(t.pais_corresp)='770' THEN '169' ELSE TRIM(t.pais_corresp) END AS "Codigo Pais",
    TRIM(t.dpto_corresp) AS "Codigo Departamento",
    TRIM(t.ciudad_corresp) AS "Codigo Municipio",
    ROUND(m.iva_generado)::bigint AS "IVA Generado",
    ROUND(m.dev_compras)::bigint  AS "IVA Recuperado Dev Compras",
    ROUND(m.impoconsumo)::bigint   AS "Impuesto al Consumo"
FROM mayor2 m
LEFT JOIN (
    SELECT DISTINCT ON (TRIM(codigo))
        TRIM(codigo) AS codigo, nit, nit_dv, tipo_identifica,
        apellido1, apellido2, nombres, descripcion, direccion_1,
        pais_corresp, dpto_corresp, ciudad_corresp
    FROM public.terceros WHERE sucursal='00'
    ORDER BY TRIM(codigo),
             (CASE WHEN TRIM(COALESCE(estado,''))='X' THEN 1 ELSE 0 END),
             (CASE WHEN TRIM(COALESCE(nit_dv,''))='' THEN 1 ELSE 0 END), ctid
) t ON t.codigo = TRIM(m.id_terc)
WHERE m.iva_generado <> 0 OR m.dev_compras <> 0 OR m.impoconsumo <> 0
)
SELECT
    MAX("Tipo Documento") AS "Tipo Documento", "Numero Identificacion", MAX("DV") AS "DV",
    MAX("Primer Apellido") AS "Primer Apellido", MAX("Segundo Apellido") AS "Segundo Apellido",
    MAX("Primer Nombre") AS "Primer Nombre", MAX("Otros Nombres") AS "Otros Nombres",
    MAX("Razon Social") AS "Razon Social", MAX("Direccion") AS "Direccion",
    MAX("Codigo Pais") AS "Codigo Pais", MAX("Codigo Departamento") AS "Codigo Departamento",
    MAX("Codigo Municipio") AS "Codigo Municipio",
    SUM("IVA Generado") AS "IVA Generado",
    SUM("IVA Recuperado Dev Compras") AS "IVA Recuperado Dev Compras",
    SUM("Impuesto al Consumo") AS "Impuesto al Consumo"
FROM reporte GROUP BY "Numero Identificacion" ORDER BY "Numero Identificacion"
`;

const CTA_1006_ANEXO = `
        ('24080510','I'),('24080512','I'),('24080513','I'),('24080514','I'),
        ('24080519','I'),('24080520','I'),('24080522','I'),('24080524','I'),
        ('24080530','J'),('24080532','J'),('24080533','J'),('24080534','J'),('24080539','J'),
        ('24100101','K'),('24100200','K'),('24100175','K')`;

const ANEXO_1006_QUERY = `
WITH cta (cuenta, col) AS (VALUES ${CTA_1006_ANEXO})
SELECT cta.cuenta AS cuenta,
    COALESCE(MAX(TRIM(ct.descripcion)), '') AS nombre_cuenta,
    COALESCE(SUM(c.valor_deb), 0) AS suma_debitos,
    COALESCE(SUM(c.valor_cre), 0) AS suma_creditos,
    COALESCE(SUM(c.valor_cre - c.valor_deb), 0) AS suma_movimiento,
    cta.col AS grupo
FROM cta
LEFT JOIN public.cgmovimiento_contable c
       ON TRIM(c.id_cuenta) = cta.cuenta AND c.id_emp = $3 AND c.lapso_doc BETWEEN $1 AND $2
LEFT JOIN public.cuentas_contab ct ON TRIM(ct.codigo) = cta.cuenta
GROUP BY cta.cuenta, cta.col
HAVING COALESCE(SUM(c.valor_deb), 0) <> 0 OR COALESCE(SUM(c.valor_cre), 0) <> 0
ORDER BY cta.col, cta.cuenta
`;

export type AnexoRow = {
  cuenta: string;
  nombre_cuenta: string;
  suma_debitos: number;
  suma_creditos: number;
  suma_movimiento: number;
  grupo: string;
};

const toNum = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
};

export const queryFormato1006 = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
  impoconsumo: number | null,
) => {
  const result = await client.query(FORMATO_1006_QUERY, [
    startLapso,
    endLapso,
    idEmp,
    impoconsumo,
  ]);
  return result.rows;
};

export const queryAnexo1006 = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
  idEmp: string,
): Promise<AnexoRow[]> => {
  const result = await client.query(ANEXO_1006_QUERY, [startLapso, endLapso, idEmp]);
  return result.rows.map((r) => ({
    cuenta: String(r.cuenta ?? "").trim(),
    nombre_cuenta: String(r.nombre_cuenta ?? "").trim(),
    suma_debitos: toNum(r.suma_debitos),
    suma_creditos: toNum(r.suma_creditos),
    suma_movimiento: toNum(r.suma_movimiento),
    grupo: String(r.grupo ?? "").trim(),
  }));
};
