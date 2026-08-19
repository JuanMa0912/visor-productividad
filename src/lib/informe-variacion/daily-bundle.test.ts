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
  margen = 0,
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
  margen_pesos: margen,
});

describe("aggregateDailyRowsForRange", () => {
  it("suma solo dias del rango en cada periodo (u/v/m)", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260601", 1, 10, 4),
      row("20260614", 2, 20, 6),
      row("20260621", 4, 40, 8),
      row("20260501", 3, 30, 5),
      row("20260514", 5, 50, 7),
      row("20250601", 6, 60, 1),
      row("20250614", 7, 70, 2),
    ];

    const range = parseInformeDayRangeId("1-14");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 6, range);
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_cur), 3);
    assert.equal(Number(agg[0].v_cur), 30);
    assert.equal(Number(agg[0].m_cur), 10);
    assert.equal(Number(agg[0].u_mom), 8);
    assert.equal(Number(agg[0].v_mom), 80);
    assert.equal(Number(agg[0].m_mom), 12);
    assert.equal(Number(agg[0].u_yoy), 13);
    assert.equal(Number(agg[0].v_yoy), 130);
    assert.equal(Number(agg[0].m_yoy), 3);
  });

  it("agrega el periodo anterior arbitrario sin mover YoY", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260801", 2, 20, 4),
      row("20260814", 3, 30, 6),
      row("20250301", 5, 50, 1),
      row("20250314", 7, 70, 2),
      row("20250801", 11, 110, 8),
      row("20250814", 13, 130, 9),
      row("20260701", 99, 990, 99),
    ];
    const range = parseInformeDayRangeId("1-14");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 8, range, {
      year: 2025,
      month: 3,
    });
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_cur), 5);
    assert.equal(Number(agg[0].u_mom), 12);
    assert.equal(Number(agg[0].v_mom), 120);
    assert.equal(Number(agg[0].u_yoy), 24);
    assert.equal(Number(agg[0].v_yoy), 240);
  });

  it("si el periodo anterior coincide con YoY, asigna ambos slots", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260801", 2, 20, 1),
      row("20250801", 4, 40, 2),
    ];
    const range = parseInformeDayRangeId("1-7");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 8, range, {
      year: 2025,
      month: 8,
    });
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_mom), 4);
    assert.equal(Number(agg[0].u_yoy), 4);
  });

  it("excluye dias fuera del rango parcial", () => {
    const dailyRows: InformeDailyDbRow[] = [
      row("20260607", 1, 10, 1),
      row("20260608", 2, 20, 2),
      row("20260614", 3, 30, 3),
      row("20260615", 9, 90, 9),
    ];

    const range = parseInformeDayRangeId("8-14");
    assert.ok(range);
    const agg = aggregateDailyRowsForRange(dailyRows, 2026, 6, range);
    assert.equal(agg.length, 1);
    assert.equal(Number(agg[0].u_cur), 5);
    assert.equal(Number(agg[0].v_cur), 50);
    assert.equal(Number(agg[0].m_cur), 5);
  });
});
