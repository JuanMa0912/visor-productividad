import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultInformeDayRangeId,
  getAvailableInformeDayRanges,
  getInformeCortesDayRanges,
  buildInformeSingleDayRange,
  buildPreciseMtdInformeDayRange,
  parseInformeDayRangeId,
  payloadMatchesInformeSelection,
} from "@/lib/informe-variacion/day-ranges";
import { computeInformePeriods } from "@/lib/informe-variacion/periods";

describe("getAvailableInformeDayRanges", () => {
  it("en dia 15 ofrece cortes cerrados + acumulado preciso 1 al 15 (sin proyectar a 21)", () => {
    const asOf = new Date(2026, 6, 15);
    const available = getAvailableInformeDayRanges(2026, 7, asOf);
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14", "mtd-15"],
    );
    assert.equal(available.at(-1)?.toDay, 15);
    assert.equal(available.at(-1)?.projection, undefined);
  });

  it("en mes cerrado muestra todos los rangos del Excel", () => {
    const asOf = new Date(2026, 6, 1);
    const available = getAvailableInformeDayRanges(2026, 6, asOf);
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14", "1-21", "15-21", "1-28", "22-28", "1-eom"],
    );
  });

  it("respeta maxDate de BD en mes en curso", () => {
    const asOf = new Date(2026, 6, 20);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "20260714");
    // maxDate=14: el acumulado 1-14 ya es corte Excel cerrado; no hay mtd extra
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "1-14", "8-14"],
    );
  });

  it("con datos hasta el dia 9 deja 1 al 7 y agrega 1 al 9 preciso", () => {
    const asOf = new Date(2026, 6, 10);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "20260709");
    assert.deepEqual(
      available.map((range) => range.id),
      ["1-7", "mtd-09"],
    );
    assert.equal(defaultInformeDayRangeId(available), "mtd-09");
  });

  it("antes del dia 7 ofrece 1 al N preciso (sin proyectar a 1-7)", () => {
    const asOf = new Date(2026, 7, 6);
    const available = getAvailableInformeDayRanges(2026, 8, asOf, "20260805");
    assert.deepEqual(
      available.map((range) => range.id),
      ["mtd-05"],
    );
    assert.equal(available[0]?.toDay, 5);
    assert.equal(available[0]?.projection, undefined);
    assert.equal(defaultInformeDayRangeId(available), "mtd-05");
  });

  it("cortes de pestaña 2 agregan proyeccion al siguiente corte Excel", () => {
    const asOf = new Date(2026, 6, 15);
    const cortes = getInformeCortesDayRanges(2026, 7, asOf);
    assert.deepEqual(
      cortes.map((range) => range.id),
      ["1-7", "1-14", "8-14", "mtd-15", "proj-1-21"],
    );
    assert.equal(cortes.at(-1)?.label, "1 al 21 (proyección)");
  });

  it("si hoy va más adelante que los datos, proyecta 1 a hoy", () => {
    const asOf = new Date(2026, 6, 20);
    const cortes = getInformeCortesDayRanges(2026, 7, asOf, "20260714");
    assert.deepEqual(
      cortes.map((range) => range.id),
      ["1-7", "1-14", "8-14", "proj-hoy-20", "proj-1-21"],
    );
    const hoy = cortes.find((range) => range.id === "proj-hoy-20");
    assert.equal(hoy?.label, "1 al 20 (proyección)");
    assert.equal(hoy?.projection?.actualToDay, 14);
    assert.equal(hoy?.projection?.targetToDay, 20);
    assert.equal(hoy?.projection?.factor, 20 / 14);
  });

  it("no duplica proyección 1 a hoy cuando hoy cae en el siguiente corte Excel", () => {
    const asOf = new Date(2026, 6, 21);
    const cortes = getInformeCortesDayRanges(2026, 7, asOf, "20260714");
    const ids = cortes.map((range) => range.id);
    assert.ok(ids.includes("proj-hoy-21"));
    assert.equal(ids.includes("proj-1-21"), false);
  });

  it("normaliza maxDate ISO desde PostgreSQL", () => {
    const asOf = new Date(2026, 6, 10);
    const available = getAvailableInformeDayRanges(2026, 7, asOf, "2026-07-09");
    assert.equal(defaultInformeDayRangeId(available), "mtd-09");
  });

  it("rechaza ids inventados tipo 1-15; acepta mtd-15", () => {
    assert.equal(parseInformeDayRangeId("1-15"), null);
    assert.equal(parseInformeDayRangeId("1-9"), null);
    assert.ok(parseInformeDayRangeId("1-14"));
    assert.ok(parseInformeDayRangeId("mtd-15"));
    assert.equal(parseInformeDayRangeId("mtd-15")?.toDay, 15);
    assert.ok(parseInformeDayRangeId("proj-1-7")); // legacy
    assert.equal(parseInformeDayRangeId("proj-hoy-20")?.toDay, 20);
    assert.equal(parseInformeDayRangeId("proj-hoy-20")?.label, "1 al 20 (proyección)");
  });

  it("includeProjection false omite el acumulado abierto (solo cerrados)", () => {
    const asOf = new Date(2026, 7, 6);
    const available = getAvailableInformeDayRanges(2026, 8, asOf, "20260805", {
      includeProjection: false,
    });
    assert.deepEqual(available.map((range) => range.id), []);
  });
});

describe("defaultInformeDayRangeId", () => {
  it("elige el acumulado preciso cuando existe; si no, el Excel mas amplio", () => {
    const asOf = new Date(2026, 6, 15);
    const available = getAvailableInformeDayRanges(2026, 7, asOf);
    assert.equal(defaultInformeDayRangeId(available), "mtd-15");

    const closed = getAvailableInformeDayRanges(2026, 6, new Date(2026, 6, 1));
    assert.equal(defaultInformeDayRangeId(closed), "1-eom");
  });
});

describe("buildPreciseMtdInformeDayRange", () => {
  it("compara 1→N vs 1→N en MoM y YoY", () => {
    const mtd = buildPreciseMtdInformeDayRange(
      2026,
      8,
      new Date(2026, 7, 14),
      "20260813",
    );
    assert.ok(mtd);
    assert.equal(mtd.id, "mtd-13");
    assert.equal(mtd.label, "1 al 13");
    const periods = computeInformePeriods(2026, 8, mtd);
    assert.equal(periods.current.from, "20260801");
    assert.equal(periods.current.to, "20260813");
    assert.equal(periods.mom.from, "20260701");
    assert.equal(periods.mom.to, "20260713");
    assert.equal(periods.yoy.from, "20250801");
    assert.equal(periods.yoy.to, "20250813");
  });
});

describe("computeInformePeriods con rango parcial", () => {
  it("acota MoM y YoY al mismo rango de dias", () => {
    const periods = computeInformePeriods(2026, 6, {
      id: "1-14",
      label: "1 al 14",
      fromDay: 1,
      toDay: 14,
    });
    assert.equal(periods.current.from, "20260601");
    assert.equal(periods.current.to, "20260614");
    assert.equal(periods.mom.from, "20260501");
    assert.equal(periods.mom.to, "20260514");
    assert.equal(periods.yoy.from, "20250601");
    assert.equal(periods.yoy.to, "20250614");
  });
});

describe("computeInformePeriods con proyección 1 a hoy", () => {
  it("SQL usa días con datos; MoM/YoY comparan 1→hoy calendario", () => {
    const asOf = new Date(2026, 6, 20);
    const cortes = getInformeCortesDayRanges(2026, 7, asOf, "20260714");
    const hoy = cortes.find((range) => range.id === "proj-hoy-20");
    assert.ok(hoy);
    const periods = computeInformePeriods(2026, 7, hoy);
    assert.equal(periods.current.from, "20260701");
    assert.equal(periods.current.to, "20260714");
    assert.equal(periods.mom.from, "20260601");
    assert.equal(periods.mom.to, "20260620");
    assert.equal(periods.yoy.from, "20250701");
    assert.equal(periods.yoy.to, "20250720");
  });
});

describe("computeInformePeriods con proyeccion legacy", () => {
  it("SQL actual usa dias reales; MoM/YoY usan el corte meta", () => {
    const periods = computeInformePeriods(2026, 8, {
      id: "proj-1-7",
      label: "1 al 7 (proyección)",
      fromDay: 1,
      toDay: 7,
      projection: {
        actualToDay: 5,
        targetToDay: 7,
        factor: 7 / 5,
        baseId: "1-7",
      },
    });
    assert.equal(periods.current.from, "20260801");
    assert.equal(periods.current.to, "20260805");
    assert.equal(periods.mom.from, "20260701");
    assert.equal(periods.mom.to, "20260707");
    assert.equal(periods.yoy.from, "20250801");
    assert.equal(periods.yoy.to, "20250807");
  });
});

describe("payloadMatchesInformeSelection", () => {
  it("detecta mes y rango distintos al payload mostrado", () => {
    const periods = computeInformePeriods(2026, 6, {
      id: "1-14",
      label: "1 al 14",
      fromDay: 1,
      toDay: 14,
    });
    const payload = { periods };
    const ranges = getAvailableInformeDayRanges(2026, 6, new Date(2026, 6, 20));

    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 6, "1-14", ranges),
      true,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 5, "1-14", ranges),
      false,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 6, "15-21", ranges),
      false,
    );
  });

  it("valida mtd-NN contra 1→N del mes", () => {
    const payload = {
      periods: { current: { from: "20260801", to: "20260813" } },
    };
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 8, "mtd-13", []),
      true,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 8, "mtd-12", []),
      false,
    );
  });

  it("valida proj-hoy-NN contra 1→hoy calendario", () => {
    const payload = {
      periods: { current: { from: "20260701", to: "20260720" } },
    };
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 7, "proj-hoy-20", []),
      true,
    );
    assert.equal(
      payloadMatchesInformeSelection(payload, 2026, 7, "proj-hoy-21", []),
      false,
    );
  });
});

describe("rango de un solo dia (d-NN)", () => {
  const asOf = new Date(2026, 7, 6); // 6-ago-2026

  it("no entra en getAvailableInformeDayRanges: el bundle mensual haria una consulta por rango", () => {
    const available = getAvailableInformeDayRanges(2026, 8, asOf, "20260805");
    assert.equal(
      available.some((range) => range.id.startsWith("d-")),
      false,
    );
  });

  it("construye el dia como rango con fromDay === toDay", () => {
    const spec = buildInformeSingleDayRange(2026, 8, 5, asOf, "20260805");
    assert.ok(spec);
    assert.equal(spec.id, "d-05");
    assert.equal(spec.fromDay, 5);
    assert.equal(spec.toDay, 5);
  });

  it("rechaza dias sin datos todavia y dias que no existen en el mes", () => {
    // el 6 aun no esta cargado (maxDate = 20260805)
    assert.equal(buildInformeSingleDayRange(2026, 8, 6, asOf, "20260805"), null);
    // febrero no tiene 31
    assert.equal(
      buildInformeSingleDayRange(2026, 2, 31, new Date(2026, 2, 15), "20260228"),
      null,
    );
  });

  it("compara contra el MISMO numero de dia del mes anterior y del año pasado", () => {
    const spec = buildInformeSingleDayRange(2026, 8, 5, asOf, "20260805");
    assert.ok(spec);
    const periods = computeInformePeriods(2026, 8, spec);
    assert.equal(periods.current.from, "20260805");
    assert.equal(periods.current.to, "20260805");
    assert.equal(periods.mom.from, "20260705");
    assert.equal(periods.mom.to, "20260705");
    assert.equal(periods.yoy.from, "20250805");
    assert.equal(periods.yoy.to, "20250805");
  });

  it("parseInformeDayRangeId reconoce d-NN y descarta basura", () => {
    assert.equal(parseInformeDayRangeId("d-05")?.fromDay, 5);
    assert.equal(parseInformeDayRangeId("d-5")?.toDay, 5);
    assert.equal(parseInformeDayRangeId("d-00"), null);
    assert.equal(parseInformeDayRangeId("d-32"), null);
    assert.equal(parseInformeDayRangeId("d-abc"), null);
  });

  it("payloadMatchesInformeSelection NO da por bueno el payload de otro rango", () => {
    // Regresion: los dias no estan en availableRanges, y la rama `if (!range) return true`
    // los daba por validos, mostrando datos de un rango distinto al pedido.
    const payloadDelMes = {
      periods: { current: { from: "20260801", to: "20260807" } },
    };
    assert.equal(
      payloadMatchesInformeSelection(payloadDelMes, 2026, 8, "d-05", []),
      false,
    );
    const payloadDelDia = {
      periods: { current: { from: "20260805", to: "20260805" } },
    };
    assert.equal(
      payloadMatchesInformeSelection(payloadDelDia, 2026, 8, "d-05", []),
      true,
    );
  });
});
