import type { PoolClient, QueryResultRow } from "pg";

export const MTODO_MEDIOS_MAGNETICOS_COLUMNS = [
  { key: "tercerotd", header: "tercerotd" },
  { key: "terceronit", header: "terceronit" },
  { key: "tercero_apellido1", header: "tercero_apellido1" },
  { key: "tercero_apellido2", header: "tercero_apellido2" },
  { key: "tercero_nombre1", header: "tercero_nombre1" },
  { key: "tercero_nombre2", header: "tercero_nombre2" },
  { key: "tercero_razon_social", header: "tercero_razon_social" },
  { key: "pais", header: "pais" },
  { key: "valor_bruto", header: "valor_bruto" },
  { key: "suma_descuentos", header: "suma_descuentos" },
  { key: "suma_impo1", header: "suma_impo1" },
  { key: "suma_impo2", header: "suma_impo2" },
  { key: "imp_bolsa", header: "imp_bolsa" },
  { key: "ingresos_brutos_propios", header: "ingresos_brutos_propios" },
  { key: "devoluciones_notas", header: "devoluciones_notas" },
  { key: "total_ingreso", header: "total_ingreso" },
] as const;

export type MtodoMediosMagneticosRow = QueryResultRow & {
  [K in (typeof MTODO_MEDIOS_MAGNETICOS_COLUMNS)[number]["key"]]:
    | string
    | number
    | null;
};

export const buildYearLapsoRange = (year: number) => ({
  startLapso: `${year}01`,
  endLapso: `${year}12`,
});

const MTODO_MEDIOS_MAGNETICOS_QUERY = `
WITH notas_tipos AS (
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
                           THEN p.vlrimpcon1 ELSE 0 END))                     AS devoluciones_pdv
    FROM public.cmmovimiento_pdv p
    INNER JOIN notas_tipos nt ON TRIM(p.id_tipdoc_fc) = nt.codigo
    WHERE p.lapso_doc BETWEEN $1 AND $2
    GROUP BY p.id_terc
),
contable_excluidas AS (
    SELECT
        pdv.id_terc,
        SUM(c.valor_cre - c.valor_deb)                                        AS movimiento_excluido
    FROM public.cgmovimiento_contable c
    INNER JOIN notas_tipos nt ON TRIM(c.doc_fc_tipo) = nt.codigo
    INNER JOIN (
        SELECT DISTINCT
            TRIM(id_emp_fc)    AS id_emp,
            TRIM(id_co_fc)     AS id_co,
            TRIM(id_tipdoc_fc) AS id_tipdoc,
            TRIM(documento_fc) AS documento,
            TRIM(id_terc)      AS id_terc
        FROM public.cmmovimiento_pdv
        WHERE lapso_doc BETWEEN $1 AND $2
          AND TRIM(id_tipdoc_fc) IN (SELECT codigo FROM notas_tipos)
    ) pdv ON TRIM(c.id_emp)        = pdv.id_emp
         AND TRIM(c.doc_fc_co)     = pdv.id_co
         AND TRIM(c.doc_fc_tipo)   = pdv.id_tipdoc
         AND TRIM(c.documento_fc)  = pdv.documento
    WHERE c.lapso_doc BETWEEN $1 AND $2
      AND (TRIM(c.id_cuenta) LIKE '4135%'
           OR TRIM(c.id_cuenta) = '42201005')
    GROUP BY pdv.id_terc
),
pdv_totales AS (
    SELECT
        p.id_terc,
        SUM(p.vlrtot_bru) + SUM(p.dscto_netos)                               AS valor_bruto,
        SUM(p.dscto_netos)                                                    AS suma_descuentos,
        SUM(p.vlrimpcon1)                                                     AS suma_impo1,
        SUM(p.vlrimpcon2)                                                     AS suma_impo2,
        SUM(CASE WHEN b.id_item IS NOT NULL
                 THEN p.vlrimpcon1 ELSE 0 END)                                AS imp_bolsa,
        SUM(CASE WHEN nt.codigo IS NULL
                 THEN p.vlrtot_bru
                      + p.vlrimpcon1
                      + p.vlrimpcon2
                      - CASE WHEN b.id_item IS NOT NULL THEN p.vlrimpcon1 ELSE 0 END
                 ELSE 0 END)                                                  AS ingresos_brutos_propios
    FROM public.cmmovimiento_pdv p
    LEFT JOIN items_bolsa b  ON p.id_item = b.id_item
    LEFT JOIN notas_tipos nt ON TRIM(p.id_tipdoc_fc) = nt.codigo
    WHERE p.lapso_doc BETWEEN $1 AND $2
    GROUP BY p.id_terc
)
SELECT
    CASE TRIM(t.tipo_identifica)
        WHEN '1' THEN '13' WHEN '2' THEN '31' WHEN '3' THEN '22'
        WHEN '4' THEN '12' WHEN '5' THEN '41' WHEN '6' THEN '21'
        WHEN '9' THEN '43' ELSE TRIM(t.tipo_identifica)
    END                                                                        AS tercerotd,
    LTRIM(TRIM(t.nit), '0')                                                   AS terceronit,
    TRIM(t.apellido1)                                                          AS tercero_apellido1,
    TRIM(t.apellido2)                                                          AS tercero_apellido2,
    SPLIT_PART(TRIM(t.nombres), ' ', 1)                                        AS tercero_nombre1,
    NULLIF(TRIM(REGEXP_REPLACE(TRIM(t.nombres), '^[^ ]+\\s*', '')), '')         AS tercero_nombre2,
    TRIM(t.descripcion)                                                        AS tercero_razon_social,
    TRIM(t.pais_corresp)                                                       AS pais,
    pt.valor_bruto,
    pt.suma_descuentos,
    pt.suma_impo1,
    pt.suma_impo2,
    pt.imp_bolsa,
    pt.ingresos_brutos_propios
        + COALESCE(ce.movimiento_excluido, 0)                                  AS ingresos_brutos_propios,
    COALESCE(pn.devoluciones_pdv, 0)
        + COALESCE(ce.movimiento_excluido, 0)                                  AS devoluciones_notas,
    pt.ingresos_brutos_propios
        - (COALESCE(pn.devoluciones_pdv, 0)
           + COALESCE(ce.movimiento_excluido, 0))
        + COALESCE(ce.movimiento_excluido, 0)                                  AS total_ingreso
FROM public.terceros t
INNER JOIN pdv_totales pt        ON t.codigo = pt.id_terc
LEFT  JOIN pdv_notas pn          ON t.codigo = pn.id_terc
LEFT  JOIN contable_excluidas ce ON t.codigo = ce.id_terc
WHERE t.sucursal = '00'
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
    rows: result.rows,
    startLapso,
    endLapso,
  };
};
