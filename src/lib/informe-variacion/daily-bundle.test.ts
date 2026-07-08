import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateDailyRowsForRange,
  type InformeDailyDbRow,
} from "@/lib/informe-variacion/daily-bundle";
import { parseInformeDayRangeId } from "@/lib/informe-variacion/day-ranges";

const row = (
  fecha: string,
  cantidad: number,
  ventas: number,
): InformeDailyDbRow => ({
  fecha_dcto: fecha,
  empresa: "empresa1",
  id_co: "001",
  id_tipo: "4",
  id_linea1: "10",
  nombre_linea1: "Linea",
  id_linea2: "20",
  nombre_linea2: "Sub",
  id_item: "100",
  item_descripcion: "Item",
  cantidad,
  ventas_netas: ventas,
});

describe("aggregateDailyRowsForRange", () => {
  it("suma solo dias del rango en cada periodo", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260601", 1, 10),
      row("20260614", 2, 20),
      row("20260621", 4, 40),
      row("20260501", 3, 30),
      row("20260514", 5, 50),
      row("20250601", 6, 60),
      row("20250614", 7, 70),
    ];

    const range = parseInformeDayRangeId("1-14");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 6, range);
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_cur), 3);
    assert.equal(Number(agg[0].v_cur), 30);
    assert.equal(Number(agg[0].u_mom), 8);
    assert.equal(Number(agg[0].v_mom), 80);
    assert.equal(Number(agg[0].u_yoy), 13);
    assert.equal(Number(agg[0].v_yoy), 130);
  });

  it("excluye dias fuera del rango parcial", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260607", 1, 10),
      row("20260608", 2, 20),
      row("20260614", 3, 30),
      row("20260615", 9, 90),
    ];

    const range = parseInformeDayRangeId("8-14");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 6, range);
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_cur), 5);
    assert.equal(Number(agg[0].v_cur), 50);
  });
});
