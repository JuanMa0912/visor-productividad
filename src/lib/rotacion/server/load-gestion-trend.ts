import { withPoolClient } from "@/lib/db";
import type { RotacionCriticalBucket } from "@/lib/rotacion/critical-digest";
import type { RotacionGestionRollRow } from "@/lib/rotacion/gestion-kpis";

const isMissingRelation = (error: unknown) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code ?? "")
      : "";
  return code === "42P01";
};

export async function loadRotacionGestionTrend(
  sedeScopes: string[],
): Promise<RotacionGestionRollRow[]> {
  const parsed = sedeScopes
    .map((scope) => {
      const idx = scope.indexOf("::");
      if (idx <= 0) return null;
      return {
        empresa: scope.slice(0, idx).trim(),
        sedeId: scope.slice(idx + 2).trim(),
      };
    })
    .filter(
      (row): row is { empresa: string; sedeId: string } =>
        Boolean(row?.empresa && row?.sedeId),
    );
  if (parsed.length === 0) return [];

  try {
    return await withPoolClient(async (client) => {
      const result = await client.query<{
        semana_fin: string | Date;
        empresa: string;
        sede_id: string;
        familia: "manufactura" | "perecederos";
        bucket: RotacionCriticalBucket;
        item_count: string | number;
        inventory_value: string | number;
        inventory_units: string | number;
        demanda_units: string | number;
        tracked_days: string | number;
      }>(
        `
        SELECT
          semana_fin,
          empresa,
          sede_id,
          familia,
          bucket,
          item_count,
          inventory_value,
          inventory_units,
          demanda_units,
          tracked_days
        FROM rotacion_gestion_semana_roll
        WHERE (empresa, sede_id) IN (
          SELECT x.empresa, x.sede_id
          FROM UNNEST($1::text[], $2::text[]) AS x(empresa, sede_id)
        )
        ORDER BY semana_fin ASC
        `,
        [
          parsed.map((row) => row.empresa),
          parsed.map((row) => row.sedeId),
        ],
      );
      return (result.rows ?? []).map((row) => ({
        semanaFin:
          row.semana_fin instanceof Date
            ? row.semana_fin.toISOString().slice(0, 10)
            : String(row.semana_fin).slice(0, 10),
        empresa: row.empresa,
        sedeId: row.sede_id,
        familia: row.familia,
        bucket: row.bucket,
        itemCount: Number(row.item_count) || 0,
        inventoryValue: Number(row.inventory_value) || 0,
        inventoryUnits: Number(row.inventory_units) || 0,
        demandaUnits: Number(row.demanda_units) || 0,
        trackedDays: Number(row.tracked_days) || 30,
      }));
    });
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}
