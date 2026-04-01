import { NextResponse } from "next/server";
import { getSessionCookieOptions, requireAuthSession } from "@/lib/auth";
import { getDbPool } from "@/lib/db";
import {
  buildInventarioLineKey,
  getInventarioLineLabel,
  getInventarioSubcategory,
  INVENTARIO_X_ITEM_SOURCE_TABLE,
  parseInventarioLineKey,
  type InventarioSubcategoryKey,
} from "@/lib/inventario-x-item";
import { canAccessPortalSection } from "@/lib/portal-sections";

type LatestDateRow = {
  max_date: string | null;
};

type InventoryFilterDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
};

type InventorySummaryDbRow = {
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
  company_count: string | number | null;
  sede_count: string | number | null;
};

type InventoryMatrixDbRow = {
  empresa: string;
  sede_id: string;
  sede_name: string;
  linea: string;
  linea_n1_codigo: string | null;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventory_units: string | number | null;
  inventory_value: string | number | null;
};

type InventorySummaryRow = {
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
  companyCount: number;
  sedeCount: number;
};

type InventoryMatrixRow = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  lineKey: string;
  lineLabel: string;
  linea: string;
  lineaN1Codigo: string | null;
  subcategory: InventarioSubcategoryKey;
  item: string;
  descripcion: string;
  unidad: string | null;
  inventoryUnits: number;
  inventoryValue: number;
};

type InventoryFilterCatalog = {
  companies: string[];
  sedes: Array<{
    empresa: string;
    sedeId: string;
    sedeName: string;
  }>;
};

type InventoryLineFilter = {
  lineaN1Codigo: string | null;
  lineaName: string;
};

const CACHE_CONTROL = "no-store";
const META_CACHE_TTL_MS = 5 * 60 * 1000;

const HIDDEN_SEDE_KEYS = new Set([
  "adm",
  "cedicavasa",
  "centrodistribucioncavasa",
  "importados",
]);

let latestDateCache:
  | { value: string | null; expiresAt: number }
  | null = null;
let filterCatalogCache:
  | { dateKey: string; value: InventoryFilterCatalog; expiresAt: number }
  | null = null;

const normalizeKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const compactToIsoDate = (value: string | null) => {
  if (!value || !/^\d{8}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
};

const toNumber = (value: string | number | null | undefined) =>
  Number(value ?? 0) || 0;

const getLatestAvailableDate = async () => {
  const now = Date.now();
  if (latestDateCache && latestDateCache.expiresAt > now) {
    return latestDateCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT MAX(fecha_consulta) AS max_date
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta ~ '^[0-9]{8}$'
      `,
    );

    const row = (result.rows?.[0] as LatestDateRow | undefined) ?? null;
    const value = row?.max_date ?? null;
    latestDateCache = {
      value,
      expiresAt: now + META_CACHE_TTL_MS,
    };
    return value;
  } finally {
    client.release();
  }
};

const getInventoryFilterCatalog = async (
  latestDateCompact: string,
): Promise<InventoryFilterCatalog> => {
  const now = Date.now();
  if (
    filterCatalogCache &&
    filterCatalogCache.dateKey === latestDateCompact &&
    filterCatalogCache.expiresAt > now
  ) {
    return filterCatalogCache.value;
  }

  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT DISTINCT
        COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') AS empresa,
        COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') AS sede_id,
        COALESCE(NULLIF(TRIM(nombre_sede), ''), NULLIF(TRIM(sede), ''), 'Sin sede') AS sede_name
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta = $1
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
      ORDER BY empresa ASC, sede_name ASC, sede_id ASC
      `,
      [latestDateCompact],
    );

    const sedes = ((result.rows ?? []) as InventoryFilterDbRow[])
      .map((row) => ({
        empresa: row.empresa,
        sedeId: row.sede_id,
        sedeName: row.sede_name,
      }))
      .filter((row) => !HIDDEN_SEDE_KEYS.has(normalizeKey(row.sedeName)));

    const companies = Array.from(new Set(sedes.map((row) => row.empresa))).sort(
      (left, right) => left.localeCompare(right, "es"),
    );

    const value = { companies, sedes };
    filterCatalogCache = {
      dateKey: latestDateCompact,
      value,
      expiresAt: now + META_CACHE_TTL_MS,
    };
    return value;
  } finally {
    client.release();
  }
};

const queryInventorySummaryRows = async ({
  latestDateCompact,
  empresa,
  sedeId,
}: {
  latestDateCompact: string;
  empresa: string | null;
  sedeId: string | null;
}): Promise<InventorySummaryRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const result = await client.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(linea), ''), 'Sin linea') AS linea,
        NULLIF(TRIM(linea_n1_codigo), '') AS linea_n1_codigo,
        COALESCE(NULLIF(TRIM(item), ''), 'sin_item') AS item,
        COALESCE(
          NULLIF(TRIM(descripcion), ''),
          COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')
        ) AS descripcion,
        NULLIF(TRIM(unidad), '') AS unidad,
        SUM(GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0))::numeric AS inventory_units,
        SUM(GREATEST(COALESCE(valor_inventario, 0), 0))::numeric AS inventory_value,
        COUNT(
          DISTINCT COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa')
        )::int AS company_count,
        COUNT(
          DISTINCT COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede')
        )::int AS sede_count
      FROM rotacion_base_item_dia_sede
      WHERE fecha_consulta = $1
        AND fecha_consulta ~ '^[0-9]{8}$'
        AND item IS NOT NULL
        AND ($2::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $2)
        AND ($3::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $3)
      GROUP BY
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad
      HAVING
        SUM(GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0)) > 0
        OR SUM(GREATEST(COALESCE(valor_inventario, 0), 0)) > 0
      ORDER BY
        inventory_value DESC,
        item ASC
      `,
      [latestDateCompact, empresa, sedeId],
    );

    return ((result.rows ?? []) as InventorySummaryDbRow[]).map((row) => {
      const subcategory = getInventarioSubcategory(row.linea_n1_codigo);
      return {
        lineKey: buildInventarioLineKey({
          linea: row.linea,
          lineaN1Codigo: row.linea_n1_codigo,
        }),
        lineLabel: getInventarioLineLabel({
          linea: row.linea,
          lineaN1Codigo: row.linea_n1_codigo,
        }),
        linea: row.linea,
        lineaN1Codigo: row.linea_n1_codigo,
        subcategory,
        item: row.item,
        descripcion: row.descripcion,
        unidad: row.unidad,
        inventoryUnits: toNumber(row.inventory_units),
        inventoryValue: toNumber(row.inventory_value),
        companyCount: toNumber(row.company_count),
        sedeCount: toNumber(row.sede_count),
      };
    });
  } finally {
    client.release();
  }
};

const queryInventoryMatrixRows = async ({
  latestDateCompact,
  empresa,
  sedeId,
  lines,
  subcategory,
  items,
}: {
  latestDateCompact: string;
  empresa: string | null;
  sedeId: string | null;
  lines: InventoryLineFilter[];
  subcategory: InventarioSubcategoryKey | null;
  items: string[];
}): Promise<InventoryMatrixRow[]> => {
  const client = await (await getDbPool()).connect();
  try {
    const params: Array<string | string[] | null> = [
      latestDateCompact,
      empresa,
      sedeId,
    ];

    const whereClauses = [
      "fecha_consulta = $1",
      "fecha_consulta ~ '^[0-9]{8}$'",
      "item IS NOT NULL",
      "($2::text IS NULL OR COALESCE(NULLIF(TRIM(empresa), ''), 'sin_empresa') = $2)",
      "($3::text IS NULL OR COALESCE(NULLIF(TRIM(sede), ''), 'sin_sede') = $3)",
    ];

    if (subcategory === "perecederos") {
      whereClauses.push(
        "COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') IN ('01', '02', '03', '04', '12')",
      );
    } else if (subcategory === "manufacturas") {
      whereClauses.push(
        "COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') NOT IN ('01', '02', '03', '04', '12')",
      );
    }

    if (lines.length > 0) {
      const lineConditions = lines.map((line) => {
        params.push(line.lineaName.toLowerCase());
        const lineNameParam = params.length;

        if (line.lineaN1Codigo) {
          params.push(line.lineaN1Codigo);
          const lineCodeParam = params.length;
          return `(
            LOWER(COALESCE(NULLIF(TRIM(linea), ''), 'sin linea')) = $${lineNameParam}
            AND COALESCE(NULLIF(TRIM(linea_n1_codigo), ''), 'sin_codigo') = $${lineCodeParam}
          )`;
        }

        return `(
          LOWER(COALESCE(NULLIF(TRIM(linea), ''), 'sin linea')) = $${lineNameParam}
          AND NULLIF(TRIM(linea_n1_codigo), '') IS NULL
        )`;
      });

      whereClauses.push(`(${lineConditions.join(" OR ")})`);
    }

    const itemFilterParam =
      items.length > 0 ? (() => {
        params.push(items);
        return params.length;
      })() : null;

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
          COALESCE(
            NULLIF(TRIM(descripcion), ''),
            COALESCE(NULLIF(TRIM(item), ''), 'Sin descripcion')
          ) AS descripcion,
          NULLIF(TRIM(unidad), '') AS unidad,
          GREATEST(COALESCE(inv_cierre_dia_ayer, 0), 0) AS inventory_units,
          GREATEST(COALESCE(valor_inventario, 0), 0) AS inventory_value
        FROM rotacion_base_item_dia_sede
        WHERE ${whereClauses.join("\n          AND ")}
      ),
      top_items AS (
        SELECT item
        FROM scoped
        GROUP BY item
        ORDER BY SUM(inventory_value) DESC, item ASC
        LIMIT ${itemFilterParam ? "999999" : "10"}
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
        SUM(inventory_units)::numeric AS inventory_units,
        SUM(inventory_value)::numeric AS inventory_value
      FROM scoped
      WHERE ${
        itemFilterParam
          ? `item = ANY($${itemFilterParam}::text[])`
          : "item IN (SELECT item FROM top_items)"
      }
      GROUP BY
        empresa,
        sede_id,
        sede_name,
        linea,
        linea_n1_codigo,
        item,
        descripcion,
        unidad
      HAVING
        SUM(inventory_units) > 0
        OR SUM(inventory_value) > 0
      ORDER BY
        empresa ASC,
        sede_name ASC,
        inventory_units DESC,
        item ASC
      `,
      params,
    );

    return ((result.rows ?? []) as InventoryMatrixDbRow[])
      .map((row) => {
        const subcategory = getInventarioSubcategory(row.linea_n1_codigo);
        return {
          empresa: row.empresa,
          sedeId: row.sede_id,
          sedeName: row.sede_name,
          lineKey: buildInventarioLineKey({
            linea: row.linea,
            lineaN1Codigo: row.linea_n1_codigo,
          }),
          lineLabel: getInventarioLineLabel({
            linea: row.linea,
            lineaN1Codigo: row.linea_n1_codigo,
          }),
          linea: row.linea,
          lineaN1Codigo: row.linea_n1_codigo,
          subcategory,
          item: row.item,
          descripcion: row.descripcion,
          unidad: row.unidad,
          inventoryUnits: toNumber(row.inventory_units),
          inventoryValue: toNumber(row.inventory_value),
        };
      })
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
    !canAccessPortalSection(session.user.allowedDashboards, "venta")
  ) {
    return withSession(
      NextResponse.json(
        { error: "No tienes permisos para esta seccion." },
        { status: 403, headers: { "Cache-Control": CACHE_CONTROL } },
      ),
    );
  }

  try {
    const latestDateCompact = await getLatestAvailableDate();
    const latestDate = compactToIsoDate(latestDateCompact);

    if (!latestDateCompact || !latestDate) {
      return withSession(
        NextResponse.json(
          {
            rows: [],
            matrixRows: [],
            filters: {
              companies: [],
              sedes: [],
            },
            meta: {
              availableDate: "",
              sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
            },
            message: "La tabla de inventario por item todavia no tiene datos.",
          },
          { headers: { "Cache-Control": CACHE_CONTROL } },
        ),
      );
    }

    const url = new URL(request.url);
    const requestMode = url.searchParams.get("mode");
    const mode =
      requestMode === "filters" ||
      requestMode === "catalog" ||
      requestMode === "table"
        ? requestMode
        : "full";
    const requestedCompany = url.searchParams.get("empresa")?.trim() || null;
    const requestedSede = url.searchParams.get("sede")?.trim() || null;
    const requestedSubcategory = url.searchParams.get("subcategory");
    const subcategory =
      requestedSubcategory === "perecederos" ||
      requestedSubcategory === "manufacturas"
        ? requestedSubcategory
        : null;
    const lines = Array.from(
      new Set(
        url.searchParams
          .getAll("line")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
      .map((value) => parseInventarioLineKey(value))
      .filter((value) => value.lineaName.length > 0)
      .map((value) => ({
        lineaN1Codigo: value.lineaN1Codigo,
        lineaName: value.lineaName,
      }));
    const items = Array.from(
      new Set(
        url.searchParams
          .getAll("item")
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ).slice(0, 10);

    const [filters, rows, matrixRows] = await Promise.all([
      getInventoryFilterCatalog(latestDateCompact),
      mode === "table" || mode === "filters"
        ? Promise.resolve<InventorySummaryRow[]>([])
        : queryInventorySummaryRows({
            latestDateCompact,
            empresa: requestedCompany,
            sedeId: requestedSede,
          }),
      mode === "catalog" || mode === "filters"
        ? Promise.resolve<InventoryMatrixRow[]>([])
        : queryInventoryMatrixRows({
            latestDateCompact,
            empresa: requestedCompany,
            sedeId: requestedSede,
            lines,
            subcategory,
            items,
          }),
    ]);

    return withSession(
      NextResponse.json(
        {
          rows,
          matrixRows,
          filters,
          meta: {
            availableDate: latestDate,
            sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
            selectedCompany: requestedCompany,
            selectedSede: requestedSede,
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
    console.error("Error en endpoint de inventario x item:", error);
    return withSession(
      NextResponse.json(
        {
          rows: [],
          matrixRows: [],
          filters: {
            companies: [],
            sedes: [],
          },
          meta: {
            availableDate: "",
            sourceTable: INVENTARIO_X_ITEM_SOURCE_TABLE,
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
