import assert from "node:assert/strict";
import test from "node:test";
import type { ClientBase } from "pg";
import { queryDrillRows } from "@/lib/margenes/drill-queries";
import type { DrillPathStep } from "@/lib/margenes/drill-path";
import type { MargenQueryFilters } from "@/lib/margenes/margen-final-query";
import { resetMargenDataSourceCache } from "@/lib/margenes/margen-data-source";

type Recorded = { sql: string; params: unknown[] };

/**
 * Cliente falso: responde `true` a los chequeos de existencia/poblado de
 * `resolveInformeMargenDataSource` (para forzar la rama hibrida) y guarda la
 * consulta real. No toca BD.
 */
const stubClient = (recorded: Recorded[]): ClientBase => {
  const query = async (sql: unknown, params?: unknown[]) => {
    const text = typeof sql === "string" ? sql : String((sql as { text: string }).text);
    if (/information_schema\.tables/.test(text) || /\) AS ok\s*$/.test(text.trim())) {
      return { rows: [{ ok: true }] };
    }
    recorded.push({ sql: text, params: params ?? [] });
    return { rows: [] };
  };
  return { query } as unknown as ClientBase;
};

const baseFilters = (): MargenQueryFilters => ({
  fromCompact: "20260801",
  toCompact: "20260813",
  fechas: [],
  empresas: [],
  sedes: ["mercamio|001", "mtodo|002"],
  categorias: [],
  lineas: [],
  sublineas: [],
  items: [],
});

/**
 * Invariante que rompe el bind de node-postgres si se descuida: cada $n citado
 * en el SQL tiene valor y no sobra ninguno. Importa porque el hibrido arma DOS
 * WHERE (roll e item_dia) sobre el MISMO array de params.
 */
const assertPlaceholdersMatchParams = ({ sql, params }: Recorded) => {
  const used = new Set(
    [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])),
  );
  const maxUsed = used.size > 0 ? Math.max(...used) : 0;
  assert.equal(
    maxUsed,
    params.length,
    `el SQL cita hasta $${maxUsed} pero se pasan ${params.length} params`,
  );
  for (let index = 1; index <= params.length; index += 1) {
    assert.ok(used.has(index), `el param $${index} nunca se usa en el SQL`);
  }
};

const runLevel = async (path: DrillPathStep[], search?: string) => {
  resetMargenDataSourceCache();
  const recorded: Recorded[] = [];
  await queryDrillRows(
    stubClient(recorded),
    baseFilters(),
    path,
    "margen_final_roll",
    search,
  );
  assert.equal(recorded.length, 1, "se espera una sola consulta de filas");
  return recorded[0];
};

const ACUM: DrillPathStep = { type: "acum", label: "ACUMULADO" };
const TIPO: DrillPathStep = { type: "tipo", id: "4", label: "MERCADO" };
const LINEA1: DrillPathStep = { type: "linea1", id: "01", label: "L1" };
const LINEA2: DrillPathStep = { type: "linea2", id: "0101", label: "L2" };
const ITEM: DrillPathStep = { type: "item", id: "123", label: "ITEM" };

test("drill nivel 1 usa el hibrido con params consistentes", async () => {
  const recorded = await runLevel([ACUM]);
  assert.match(recorded.sql, /FROM margen_item_dia_roll/);
  assert.match(recorded.sql, /FROM margen_final_roll/);
  assertPlaceholdersMatchParams(recorded);
});

test("drill nivel 4 comparte el placeholder de busqueda entre roll e item_dia", async () => {
  const recorded = await runLevel([ACUM, TIPO, LINEA1, LINEA2], "leche");
  assert.match(recorded.sql, /FROM margen_item_dia_roll/);
  // El LIKE aparece dos veces (una por tabla) apuntando al mismo $n.
  const likes = [...recorded.sql.matchAll(/LOWER\(id_item\) LIKE \$(\d+)/g)];
  assert.equal(likes.length, 2);
  assert.equal(likes[0][1], likes[1][1]);
  assertPlaceholdersMatchParams(recorded);
});

test("drill nivel 5 (factura) no encola params de item_dia", async () => {
  const recorded = await runLevel([ACUM, TIPO, LINEA1, LINEA2, ITEM]);
  assert.doesNotMatch(recorded.sql, /margen_item_dia_roll/);
  assertPlaceholdersMatchParams(recorded);
});

test("drill nivel 1 sobre Dinastia NO toca margen_item_dia_roll", async () => {
  // margen_item_dia_roll solo se alimenta de margen_final_roll: no tiene filas
  // de Dinastia, asi que el hibrido dejaria los conteos de dimensiones en 0.
  resetMargenDataSourceCache();
  const recorded: Recorded[] = [];
  await queryDrillRows(
    stubClient(recorded),
    baseFilters(),
    [ACUM],
    "margen_dinastia_roll",
  );
  assert.equal(recorded.length, 1);
  assert.doesNotMatch(recorded[0].sql, /margen_item_dia_roll/);
  assert.match(recorded[0].sql, /FROM margen_dinastia_roll/);
  assertPlaceholdersMatchParams(recorded[0]);
});
