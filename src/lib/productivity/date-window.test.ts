import assert from "node:assert/strict";
import test from "node:test";
import {
  filterProductivityByDateRange,
  resolveProductivityDefaultRange,
  toProductivityCompactDate,
} from "./date-window";

test("resolveProductivityDefaultRange cubre lookback inclusivo", () => {
  const range = resolveProductivityDefaultRange(new Date(2026, 7, 12, 15, 0, 0));
  assert.equal(range.end, "2026-08-12");
  assert.equal(range.start, "2026-07-04");
});

test("toProductivityCompactDate convierte ISO", () => {
  assert.equal(toProductivityCompactDate("2026-08-12"), "20260812");
});

test("filterProductivityByDateRange respeta from/to", () => {
  const rows = [
    { date: "2026-08-01" },
    { date: "2026-08-10" },
    { date: "2026-08-20" },
  ];
  assert.deepEqual(
    filterProductivityByDateRange(rows, "2026-08-05", "2026-08-15").map(
      (row) => row.date,
    ),
    ["2026-08-10"],
  );
  assert.equal(filterProductivityByDateRange(rows, null, null).length, 3);
});
