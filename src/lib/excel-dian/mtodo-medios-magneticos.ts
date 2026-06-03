import type { PoolClient, QueryResultRow } from "pg";

export const MTODO_MEDIOS_MAGNETICOS_COLUMNS = [
  { key: "Concepto", header: "Concepto" },
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
  { key: "Ingresos Brutos Recibidos", header: "Ingresos Brutos Recibidos" },
  {
    key: "Devoluciones Rebajas Descuentos",
    header: "Devoluciones Rebajas Descuentos",
  },
] as const;

export type MtodoMediosMagneticosRow = QueryResultRow & {
  [K in (typeof MTODO_MEDIOS_MAGNETICOS_COLUMNS)[number]["key"]]:
    | string
    | number
    | null;
};

/** Persona natural (cédula) en el layout DIAN usado por esta exportación. */
const TERCERO_TD_PERSONA_NATURAL = "13";

const normalizeTercerotdForExportRule = (
  raw: string | number | null | undefined,
): string => {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
};

/**
 * Reglas solo para el Excel (no modifica el SQL).
 * Si "Tipo Documento" es 13 (persona natural), "Razon Social" debe ir vacía;
 * en el resto de tipos de documento se conserva el valor devuelto por la consulta.
 */
export const applyMtodoMediosMagneticosExportRowRules = (
  rows: MtodoMediosMagneticosRow[],
): MtodoMediosMagneticosRow[] =>
  rows.map((row) => {
    if (
      normalizeTercerotdForExportRule(row["Tipo Documento"]) !==
      TERCERO_TD_PERSONA_NATURAL
    ) {
      return row;
    }
    return { ...row, "Razon Social": null };
  });

export const buildYearLapsoRange = (year: number) => ({
  startLapso: `${year}01`,
  endLapso: `${year}12`,
});

const MTODO_MEDIOS_MAGNETICOS_QUERY = `
WITH
notas_tipos_pdv AS (
    SELECT DISTINCT TRIM(p.id_tipdoc_fc) AS codigo
    FROM public.cmmovimiento_pdv p
    WHERE p.lapso_doc BETWEEN $1 AND $2
      AND TRIM(p.id_tipdoc_fc) IN (
            SELECT TRIM(codigo) FROM public.tipos_documentos
            WHERE descripcion ILIKE '%NOTA%'
      )
),
items_bolsa AS (
    SELECT id_item FROM public.items WHERE TRIM(id_item) = '901093'
),
pdv_notas AS (
    SELECT
        p.id_terc,
        ABS(SUM(p.vlrtot_bru) + SUM(p.dscto_netos))
            - ABS(SUM(p.dscto_netos))
            + ABS(SUM(p.vlrimpcon1))
            + ABS(SUM(p.vlrimpcon2))
            - ABS(SUM(CASE WHEN TRIM(p.id_item) = '901093'
                           THEN p.vlrimpcon1 ELSE 0 END))                    AS devoluciones_pdv
    FROM public.cmmovimiento_pdv p
    INNER JOIN notas_tipos_pdv nt ON TRIM(p.id_tipdoc_fc) = nt.codigo
    WHERE p.lapso_doc BETWEEN $1 AND $2
    GROUP BY p.id_terc
),
contable_excluidas_pdv AS (
    SELECT pdv.id_terc, SUM(c.valor_cre - c.valor_deb) AS movimiento_excluido
    FROM public.cgmovimiento_contable c
    INNER JOIN notas_tipos_pdv nt ON TRIM(c.doc_fc_tipo) = nt.codigo
    INNER JOIN (
        SELECT DISTINCT
            TRIM(id_emp_fc) AS id_emp, TRIM(id_co_fc) AS id_co,
            TRIM(id_tipdoc_fc) AS id_tipdoc, TRIM(documento_fc) AS documento,
            TRIM(id_terc) AS id_terc
        FROM public.cmmovimiento_pdv
        WHERE lapso_doc BETWEEN $1 AND $2
          AND TRIM(id_tipdoc_fc) IN (SELECT codigo FROM notas_tipos_pdv)
    ) pdv ON TRIM(c.id_emp)=pdv.id_emp AND TRIM(c.doc_fc_co)=pdv.id_co
         AND TRIM(c.doc_fc_tipo)=pdv.id_tipdoc AND TRIM(c.documento_fc)=pdv.documento
    WHERE c.lapso_doc BETWEEN $1 AND $2
      AND (TRIM(c.id_cuenta) LIKE '4135%' OR TRIM(c.id_cuenta) = '42201005')
    GROUP BY pdv.id_terc
),
pdv_totales AS (
    SELECT
        p.id_terc,
        SUM(CASE WHEN nt.codigo IS NULL
                 THEN p.vlrtot_bru + p.vlrimpcon1 + p.vlrimpcon2
                      - CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END
                 ELSE 0 END) AS ingresos_brutos_propios
    FROM public.cmmovimiento_pdv p
    LEFT JOIN items_bolsa b      ON p.id_item = b.id_item
    LEFT JOIN notas_tipos_pdv nt ON TRIM(p.id_tipdoc_fc) = nt.codigo
    WHERE p.lapso_doc BETWEEN $1 AND $2
    GROUP BY p.id_terc
),
notas_tipos_central AS (
    SELECT DISTINCT TRIM(v.id_tipdoc) AS codigo
    FROM public.cmmovimiento_ventas v
    WHERE v.id_emp='01' AND v.lapso_doc BETWEEN $1 AND $2
      AND TRIM(v.id_tipdoc) IN (SELECT TRIM(codigo) FROM public.tipos_documentos WHERE descripcion ILIKE '%NOTA%')
      AND TRIM(v.id_tipdoc) NOT IN (
            SELECT DISTINCT TRIM(id_tipdoc_fc) FROM public.cmmovimiento_pdv
            WHERE id_emp_fc='01' AND lapso_doc BETWEEN $1 AND $2)
),
central_notas AS (
    SELECT
        v.id_terc,
        ABS(SUM(v.tot_bruto)) - ABS(SUM(v.dscto_netos))
            + ABS(SUM(v.vlrimpoconsumo1)) + ABS(SUM(v.vlrimpoconsumo2))      AS devoluciones_central
    FROM public.cmmovimiento_ventas v
    INNER JOIN notas_tipos_central nt ON TRIM(v.id_tipdoc) = nt.codigo
    WHERE v.id_emp='01' AND v.lapso_doc BETWEEN $1 AND $2
    GROUP BY v.id_terc
),
contable_excluidas_central AS (
    SELECT ven.id_terc, SUM(c.valor_cre - c.valor_deb) AS movimiento_excluido
    FROM public.cgmovimiento_contable c
    INNER JOIN notas_tipos_central nt ON TRIM(c.doc_fc_tipo) = nt.codigo
    INNER JOIN (
        SELECT DISTINCT TRIM(id_emp) AS id_emp, TRIM(id_co) AS id_co,
            TRIM(id_tipdoc) AS id_tipdoc, TRIM(documento_fc) AS documento, TRIM(id_terc) AS id_terc
        FROM public.cmmovimiento_ventas
        WHERE id_emp='01' AND lapso_doc BETWEEN $1 AND $2
          AND TRIM(id_tipdoc) IN (SELECT codigo FROM notas_tipos_central)
    ) ven ON TRIM(c.id_emp)=ven.id_emp AND TRIM(c.doc_fc_co)=ven.id_co
         AND TRIM(c.doc_fc_tipo)=ven.id_tipdoc AND TRIM(c.documento_fc)=ven.documento
    WHERE c.id_emp='01' AND c.lapso_doc BETWEEN $1 AND $2
      AND (TRIM(c.id_cuenta) LIKE '4135%' OR TRIM(c.id_cuenta) = '42201005')
    GROUP BY ven.id_terc
),
central_totales AS (
    SELECT
        v.id_terc,
        SUM(CASE WHEN nt.codigo IS NULL
                 THEN v.tot_bruto - v.dscto_netos + v.vlrimpoconsumo1 + v.vlrimpoconsumo2
                 ELSE 0 END) AS ingresos_brutos_propios
    FROM public.cmmovimiento_ventas v
    LEFT JOIN notas_tipos_central nt ON TRIM(v.id_tipdoc) = nt.codigo
    WHERE v.id_emp='01' AND v.lapso_doc BETWEEN $1 AND $2
      AND TRIM(v.id_tipdoc) NOT IN (
            SELECT DISTINCT TRIM(id_tipdoc_fc) FROM public.cmmovimiento_pdv
            WHERE id_emp_fc='01' AND lapso_doc BETWEEN $1 AND $2)
      AND TRIM(v.id_tipdoc) NOT IN ('VD')
    GROUP BY v.id_terc
)

SELECT
    '4001'                                                                   AS "Concepto",
    CASE TRIM(t.tipo_identifica)
        WHEN '1' THEN '13' WHEN '2' THEN '31' WHEN '3' THEN '22'
        WHEN '4' THEN '12' WHEN '5' THEN '41' WHEN '6' THEN '21'
        WHEN '9' THEN '43' ELSE TRIM(t.tipo_identifica)
    END                                                                      AS "Tipo Documento",
    LTRIM(TRIM(t.nit), '0')                                                  AS "Numero Identificacion",
    TRIM(t.nit_dv)                                                           AS "DV",
    TRIM(t.apellido1)                                                        AS "Primer Apellido",
    TRIM(t.apellido2)                                                        AS "Segundo Apellido",
    SPLIT_PART(TRIM(t.nombres), ' ', 1)                                      AS "Primer Nombre",
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '')       AS "Otros Nombres",
    TRIM(t.descripcion)                                                      AS "Razon Social",
    TRIM(t.direccion_1)                                                      AS "Direccion",
    CASE WHEN TRIM(t.pais_corresp) = '770' THEN '169'
         ELSE TRIM(t.pais_corresp) END                                       AS "Codigo Pais",
    TRIM(t.dpto_corresp)                                                     AS "Codigo Departamento",
    TRIM(t.ciudad_corresp)                                                   AS "Codigo Municipio",
    ROUND(
        (COALESCE(pt.ingresos_brutos_propios, 0) + COALESCE(cep.movimiento_excluido, 0))
      + (COALESCE(ct.ingresos_brutos_propios, 0) + COALESCE(cec.movimiento_excluido, 0))
    )::bigint                                                                AS "Ingresos Brutos Recibidos",
    ROUND(
        (COALESCE(pn.devoluciones_pdv, 0) + COALESCE(cep.movimiento_excluido, 0))
      + (COALESCE(cn.devoluciones_central, 0) + COALESCE(cec.movimiento_excluido, 0))
    )::bigint                                                                AS "Devoluciones Rebajas Descuentos"
FROM public.terceros t
LEFT JOIN pdv_totales pt                  ON t.codigo = pt.id_terc
LEFT JOIN pdv_notas pn                    ON t.codigo = pn.id_terc
LEFT JOIN contable_excluidas_pdv cep      ON t.codigo = cep.id_terc
LEFT JOIN central_totales ct              ON t.codigo = ct.id_terc
LEFT JOIN central_notas cn                ON t.codigo = cn.id_terc
LEFT JOIN contable_excluidas_central cec  ON t.codigo = cec.id_terc
WHERE t.sucursal = '00'
  AND (pt.id_terc IS NOT NULL OR ct.id_terc IS NOT NULL)
  AND (COALESCE(pt.ingresos_brutos_propios, 0) + COALESCE(ct.ingresos_brutos_propios, 0)
       + COALESCE(pn.devoluciones_pdv, 0)      + COALESCE(cn.devoluciones_central, 0)) <> 0
ORDER BY t.nit
`;

export const queryMtodoMediosMagneticos = async (
  client: PoolClient,
  startLapso: string,
  endLapso: string,
) => {
  const result = await client.query<MtodoMediosMagneticosRow>(
    MTODO_MEDIOS_MAGNETICOS_QUERY,
    [startLapso, endLapso],
  );
  return {
    rows: applyMtodoMediosMagneticosExportRowRules(result.rows),
    startLapso,
    endLapso,
  };
};
