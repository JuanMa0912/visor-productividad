import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import { canAccessPortalSection } from "@/lib/portal-sections";

type AvailableBoundsRow = {
  min_date: string | null;
  max_date: string | null;
};

type RotationDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  total_sales: string | number | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  rotation: string | number | null;
  tracked_days: number | string | null;
  last_movement_date: string | null;
  effective_days: number | string | null;
  status: "Sin movimiento" | "Baja rotacion" | "En seguimiento";
};

type RotationRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  linea: string;
  lineaN1Codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  totalSales: number;
  inventoryUnits: number;
  inventoryValue: number;
  rotation: number;
  trackedDays: number;
  lastMovementDate: string | null;
  effectiveDays: number | null;
  status: "Sin movimiento" | "Baja rotacion" | "En seguimiento";
};

const CACHE_CONTROL = "no-store";
const LOW_ROTATION_THRESHOLD = 0.65;
const MAX_ROWS_PER_SEDE = 25;
const HIDDEN_SEDE_KEYS = new Set([
  "adm",
  "cedicavasa",
  "centrodistribucioncavasa",
  "importados",
]);

const isIsoDate = (value: string | null) =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

const compactToIsoDate = (value: string | null) => {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const isoToCompactDate = (value: string) => value.replace(/-/g, "");

const shiftDate = (dateKey: string, offsetDays: number) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const clampDateRange = ({
  start,
  end,
  minDate,
  maxDate,
}: {
  start: string;
  end: string;
  minDate: string;
  maxDate: string;
}) => {
  let nextStart = start;
  let nextEnd = end;

  if (nextStart < minDate) nextStart = minDate;
  if (nextStart > maxDate) nextStart = maxDate;
  if (nextEnd < minDate) nextEnd = minDate;
  if (nextEnd > maxDate) nextEnd = maxDate;
  if (nextStart > nextEnd) nextStart = nextEnd;

  return { start: nextStart, end: nextEnd };
};

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const parsePositiveNumber = (value: string | null) => {
  if (!value) return null;
  const normalized = value.replace(/[^\d]/g, "");
  if (!normalized) return null;
  return Number(normalized);
};

const getAvailableBounds = async () => {
  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        MIN(fecha_consulta) AS min_date,
        MAX(fecha_consulta) AS max_date
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta ~ '^[0-9]{8}$'
      `,
    );
    return (result.rows?.[0] as AvailableBoundsRow | undefined) ?? null;
  } finally {
    client.release();
  }
};

const queryRotationRows = async ({
  startDate,
  endDate,
  minInventoryValue,
}: {
  startDate: string;
  endDate: string;
  minInventoryValue: number | null;
}): Promise<RotationRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      WITH scoped AS (
        SELECT
          COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
          COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
          COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name,
          COALESCE(NULLIF(TRIM(linea), ''), 'Sin linea') AS linea,
          NULLIF(TRIM(linea_n1_codigo), '') AS linea_n1_codigo,
          COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
          COALESCE(NULLIF(TRIM(descripcion), ''), COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')) AS descripcion,
          NULLIF(TRIM(unidad), '') AS unidad,
          COALESCE(venta_sin_impuesto, 0) AS venta_sin_impuesto,
          GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0) AS inventory_units,
          GREATEST(COALESCE(valor_inventario, 0), 0) AS inventory_value,
          TO_DATE(fecha_consulta, 'YYYYMMDD') AS consulta_date,
          CASE
            WHEN fecha_ultima_compra ~ '^[0-9]{8}$' THEN TO_DATE(fecha_ultima_compra, 'YYYYMMDD')
            ELSE NULL
          END AS last_movement_date,
          fecha_carga
        FROM rotacion_base_item_dia_sede
        WHERE fecha_consulta BETWEEN $1 AND $2
          AND fecha_consulta ~ '^[0-9]{8}$'
          AND item IS NOT NULL
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY empresa, sede_id, item
            ORDER BY consulta_date DESC, fecha_carga DESC
          ) AS latest_rank
        FROM scoped
      ),
      aggregated AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          SUM(venta_sin_impuesto)::numeric AS total_sales,
          AVG(inventory_value)::numeric AS avg_inventory_value,
          MAX(last_movement_date) AS last_movement_date,
          MAX(CASE WHEN latest_rank = 1 THEN inventory_units END)::numeric AS inventory_units,
          MAX(CASE WHEN latest_rank = 1 THEN inventory_value END)::numeric AS inventory_value,
          COUNT(*)::int AS tracked_days
        FROM ranked
        GROUP BY
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad
      ),
      enriched AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          total_sales,
          COALESCE(inventory_units, 0) AS inventory_units,
          COALESCE(inventory_value, 0) AS inventory_value,
          tracked_days,
          last_movement_date,
          CASE
            WHEN avg_inventory_value <= 0 THEN CASE WHEN total_sales > 0 THEN 999999::numeric ELSE 0::numeric END
            ELSE total_sales / NULLIF(avg_inventory_value, 0)
          END AS rotation,
          CASE
            WHEN last_movement_date IS NULL THEN NULL
            ELSE ($3::date - last_movement_date)
          END::int AS effective_days
        FROM aggregated
        WHERE COALESCE(inventory_value, 0) > 0
          AND ($4::numeric IS NULL OR COALESCE(inventory_value, 0) >= $4)
      ),
      ranked_visible AS (
        SELECT
          empresa,
          sede_id,
          sede_name,
          linea,
          linea_n1_codigo,
          item,
          descripcion,
          unidad,
          total_sales,
          inventory_units,
          inventory_value,
          rotation,
          tracked_days,
          last_movement_date,
          effective_days,
          CASE
            WHEN total_sales <= 0 AND inventory_value > 0 THEN 'Sin movimiento'
            WHEN COALESCE(rotation, 0) < $5 THEN 'Baja rotacion'
            ELSE 'En seguimiento'
          END AS status,
          ROW_NUMBER() OVER (
            PARTITION BY sede_name
            ORDER BY
              CASE
                WHEN total_sales <= 0 AND inventory_value > 0 THEN 0
                WHEN COALESCE(rotation, 0) < $5 THEN 1
                ELSE 2
              END,
              COALESCE(rotation, 0) ASC,
              inventory_value DESC,
              item ASC
          ) AS sede_rank
        FROM enriched
      )
      SELECT
        empresa,
        sede_id,
        sede_name,
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad,
        total_sales,
        inventory_units,
        inventory_value,
        rotation,
        tracked_days,
        TO_CHAR(last_movement_date, 'YYYY-MM-DD') AS last_movement_date,
        effective_days,
        status
      FROM ranked_visible
      WHERE sede_rank <= $6
      ORDER BY sede_name ASC, sede_rank ASC
      `,
      [
        isoToCompactDate(startDate),
        isoToCompactDate(endDate),
        endDate,
        minInventoryValue,
        LOW_ROTATION_THRESHOLD,
        MAX_ROWS_PER_SEDE,
      ],
    );

    return ((result.rows ?? []) as RotationDbRow[])
      .map((row) => ({
        empresa: row.empresa,
        sedeId: row.sede_id,
        sedeName: row.sede_name,
        linea: row.linea,
        lineaN1Codigo: row.linea_n1_codigo,
        item: row.item,
        descripcion: row.descripcion,
        unidad: row.unidad,
        totalSales: toNumber(row.total_sales),
        inventoryUnits: toNumber(row.inventory_units),
        inventoryValue: toNumber(row.inventory_value),
        rotation: toNumber(row.rotation),
        trackedDays: toNumber(row.tracked_days),
        lastMovementDate: row.last_movement_date,
        effectiveDays:
          row.effective_days === null || row.effective_days === undefined
            ? null
            : toNumber(row.effective_days),
        status: row.status,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));
  } finally {
    client.release();
  }
};

export async function GET(request: Request) {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  if (
    session.user.role !== "admin" &&
    !canAccessPortalSection(session.user.allowedDashboards, "producto")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    const bounds = await getAvailableBounds();
    const minAvailableDate = compactToIsoDate(bounds?.min_date ?? null);
    const maxAvailableDate = compactToIsoDate(bounds?.max_date ?? null);

    if (!minAvailableDate || !maxAvailableDate) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            stats: {
              evaluatedSedes: 0,
              visibleItems: 0,
              withoutMovement: 0,
            },
            meta: {
              effectiveRange: { start: "", end: "" },
              availableRange: { min: "", max: "" },
              sourceTable: "rotacion_base_item_dia_sede",
              minInventoryValue: null,
            },
            message: "La tabla de rotacion no tiene datos disponibles.",
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const url = new URL(request.url);
    const requestedStart = url.searchParams.get("start");
    const requestedEnd = url.searchParams.get("end");
    const minInventoryValue = parsePositiveNumber(
      url.searchParams.get("minInventoryValue"),
    );

    const rawEndDate = isIsoDate(requestedEnd) ? requestedEnd! : maxAvailableDate;
    const rawStartDate = isIsoDate(requestedStart)
      ? requestedStart!
      : shiftDate(rawEndDate, -29);

    const effectiveRange = clampDateRange({
      start: rawStartDate,
      end: rawEndDate,
      minDate: minAvailableDate,
      maxDate: maxAvailableDate,
    });

    const rows = await queryRotationRows({
      startDate: effectiveRange.start,
      endDate: effectiveRange.end,
      minInventoryValue,
    });

    const stats = {
      evaluatedSedes: new Set(rows.map((row) => row.sedeName)).size,
      visibleItems: rows.length,
      withoutMovement: rows.filter((row) => row.status === "Sin movimiento").length,
    };

    return withSession(
      NextResponse.json(
        {
          rows,
          stats,
          meta: {
            effectiveRange,
            availableRange: {
              min: minAvailableDate,
              max: maxAvailableDate,
            },
            sourceTable: "rotacion_base_item_dia_sede",
            minInventoryValue,
          },
        },
        {
          headers: {
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Source": "database",
          },
        },
      ),
    );
  } catch (error) {
    console.error("Error en endpoint de rotacion:", error);
    return withSession(
      NextResponse.json(
        {
          rows: [],
          stats: {
            evaluatedSedes: 0,
            visibleItems: 0,
            withoutMovement: 0,
          },
          meta: {
            effectiveRange: { start: "", end: "" },
            availableRange: { min: "", max: "" },
            sourceTable: "rotacion_base_item_dia_sede",
            minInventoryValue: null,
          },
          error:
            "Error de conexion: " +
            (error instanceof Error ? error.message : String(error)),
        },
        {
          status: 500,
          headers: { "Cache-Control": CACHE_CONTROL },
        },
      ),
    );
  }
}
