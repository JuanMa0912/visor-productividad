import type { PoolClient } from "pg";
import { withPoolClient } from "@/lib/db";

/**
 * Efectividad de restock (0–100).
 *
 * Denominador: ítems de la sede con al menos una marca a `surtido` en contexto
 * `restock` cuya **primera** marca cae dentro del rango del correo.
 * Numerador: de esos, cuántos tuvieron venta (unidades > 0) en o después de
 * esa fecha y hasta el fin del rango.
 *
 * No usa la cohorte S actual (sin venta en el periodo): mediría ~0 por definición.
 */
export type RestockEffectivenessScore = {
  score: number | null;
  markedSurtidoCount: number;
  soldAfterCount: number;
  /** true si faltó tabla/matview o la consulta falló de forma recuperable. */
  unavailable: boolean;
};

export const emptyRestockEffectivenessScore = (
  unavailable = false,
): RestockEffectivenessScore => ({
  score: null,
  markedSurtidoCount: 0,
  soldAfterCount: 0,
  unavailable,
});

export const computeRestockEffectivenessScore = (
  markedSurtidoCount: number,
  soldAfterCount: number,
): RestockEffectivenessScore => {
  const marked = Math.max(0, Math.floor(markedSurtidoCount));
  const sold = Math.max(0, Math.min(marked, Math.floor(soldAfterCount)));
  if (marked === 0) {
    return {
      score: null,
      markedSurtidoCount: 0,
      soldAfterCount: 0,
      unavailable: false,
    };
  }
  return {
    score: Math.round((100 * sold) / marked),
    markedSurtidoCount: marked,
    soldAfterCount: sold,
    unavailable: false,
  };
};

const isMissingRelationError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  return code === "42P01";
};

type MarkRow = {
  empresa: string;
  sede_id: string;
  item: string;
  t0: string;
};

/**
 * Consulta score para una sede y rango ISO `YYYY-MM-DD`.
 */
export async function queryRestockEffectivenessScore(
  client: PoolClient,
  input: {
    empresa: string;
    sedeId: string;
    dateStartIso: string;
    dateEndIso: string;
  },
): Promise<RestockEffectivenessScore> {
  let marks: MarkRow[];
  try {
    const marksResult = await client.query<MarkRow>(
      `
      SELECT
        a.empresa,
        a.sede_id,
        a.item,
        MIN((a.changed_at AT TIME ZONE 'America/Bogota')::date)::text AS t0
      FROM rotacion_cero_item_estado_audit a
      WHERE a.context = 'restock'
        AND a.estado_nuevo = 'surtido'
        AND LOWER(TRIM(a.empresa)) = LOWER(TRIM($1::text))
        AND TRIM(a.sede_id) = TRIM($2::text)
      GROUP BY a.empresa, a.sede_id, a.item
      HAVING MIN((a.changed_at AT TIME ZONE 'America/Bogota')::date)
        BETWEEN $3::date AND $4::date
      `,
      [input.empresa, input.sedeId, input.dateStartIso, input.dateEndIso],
    );
    marks = marksResult.rows ?? [];
  } catch (error) {
    if (isMissingRelationError(error)) {
      console.warn(
        "[restock-effectiveness] falta rotacion_cero_item_estado_audit:",
        error instanceof Error ? error.message : error,
      );
      return emptyRestockEffectivenessScore(true);
    }
    throw error;
  }

  if (marks.length === 0) {
    return computeRestockEffectivenessScore(0, 0);
  }

  // Ventas posteriores: preferir matview limpia; fallback a tabla base.
  const soldQueries = [
    {
      label: "rotacion_item_dia_clean",
      sql: `
        SELECT COUNT(*)::int AS sold_after_count
        FROM UNNEST($1::text[], $2::text[], $3::text[], $4::date[]) AS m(empresa, sede_id, item, t0)
        WHERE EXISTS (
          SELECT 1
          FROM rotacion_item_dia_clean d
          WHERE LOWER(TRIM(d.empresa)) = LOWER(TRIM(m.empresa))
            AND TRIM(d.sede_id) = TRIM(m.sede_id)
            AND TRIM(d.item) = TRIM(m.item)
            AND d.fecha >= m.t0
            AND d.fecha <= $5::date
            AND COALESCE(d.unidades_vendidas_dia, 0) > 0
        )
      `,
    },
    {
      label: "rotacion_base_item_dia_sede",
      sql: `
        SELECT COUNT(*)::int AS sold_after_count
        FROM UNNEST($1::text[], $2::text[], $3::text[], $4::date[]) AS m(empresa, sede_id, item, t0)
        WHERE EXISTS (
          SELECT 1
          FROM rotacion_base_item_dia_sede d
          WHERE LOWER(TRIM(d.empresa)) = LOWER(TRIM(m.empresa))
            AND TRIM(d.sede_id) = TRIM(m.sede_id)
            AND TRIM(d.item) = TRIM(m.item)
            AND d.fecha::date >= m.t0
            AND d.fecha::date <= $5::date
            AND COALESCE(d.cantidad_vendida, d.unidades_vendidas, 0) > 0
        )
      `,
    },
  ] as const;

  const empresas = marks.map((m) => m.empresa);
  const sedes = marks.map((m) => m.sede_id);
  const items = marks.map((m) => m.item);
  const t0s = marks.map((m) => m.t0);

  for (const candidate of soldQueries) {
    try {
      const soldResult = await client.query<{ sold_after_count: number | string }>(
        candidate.sql,
        [empresas, sedes, items, t0s, input.dateEndIso],
      );
      const soldAfter = Number(soldResult.rows[0]?.sold_after_count ?? 0);
      return computeRestockEffectivenessScore(marks.length, soldAfter);
    } catch (error) {
      if (isMissingRelationError(error)) {
        console.warn(
          `[restock-effectiveness] ventas no disponibles vía ${candidate.label}:`,
          error instanceof Error ? error.message : error,
        );
        continue;
      }
      // Columnas distintas en base: probar siguiente.
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: string }).code)
          : "";
      if (code === "42703") {
        console.warn(
          `[restock-effectiveness] columnas no coinciden en ${candidate.label}; se prueba fallback.`,
        );
        continue;
      }
      throw error;
    }
  }

  // Hubo marcas pero no pudimos leer ventas: devolver N con sold 0 y marcar unavailable.
  console.warn(
    "[restock-effectiveness] marcas encontradas pero sin fuente de ventas diarias.",
  );
  return {
    ...computeRestockEffectivenessScore(marks.length, 0),
    unavailable: true,
  };
}

export async function loadRestockEffectivenessScore(input: {
  empresa: string;
  sedeId: string;
  dateStartIso: string;
  dateEndIso: string;
}): Promise<RestockEffectivenessScore> {
  return withPoolClient((client) =>
    queryRestockEffectivenessScore(client, input),
  );
}
