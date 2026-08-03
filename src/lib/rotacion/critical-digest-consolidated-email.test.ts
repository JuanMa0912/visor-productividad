import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RotacionCriticalDigest } from "@/lib/rotacion/critical-digest";
import {
  aggregateConsolidatedDigestTotals,
  buildRotacionCriticalDigestConsolidatedHtml,
  buildRotacionCriticalDigestConsolidatedSubject,
  buildRotacionCriticalDigestConsolidatedText,
} from "@/lib/rotacion/critical-digest-consolidated-email";

const emptySection = () => ({
  total: { itemCount: 0, totalInventario: 0 },
  demandaD: { itemCount: 0, totalInventario: 0, diasInventario: 0 },
  ceroRotacion: {
    itemCount: 0,
    sinVerificar: 0,
    seguimiento: 0,
    surtido: 0,
    surtidoPct: null,
  },
  restockS: {
    itemCount: 0,
    sinVerificar: 0,
    seguimiento: 0,
    surtido: 0,
    surtidoPct: null,
  },
});

const digestFor = (
  overrides: Partial<RotacionCriticalDigest> &
    Pick<RotacionCriticalDigest, "sedeName" | "sedeId">,
): RotacionCriticalDigest => ({
  empresa: "mtodo",
  dateRange: { start: "2026-05-01", end: "2026-06-15" },
  daysConsulted: 46,
  total: { itemCount: 10, totalInventario: 1_000_000 },
  perecederos: {
    ...emptySection(),
    total: { itemCount: 6, totalInventario: 600_000 },
    demandaD: { itemCount: 2, totalInventario: 200_000, diasInventario: 10 },
    ceroRotacion: {
      itemCount: 3,
      sinVerificar: 1,
      seguimiento: 1,
      surtido: 1,
      surtidoPct: 33.3,
    },
    restockS: {
      itemCount: 1,
      sinVerificar: 0,
      seguimiento: 0,
      surtido: 1,
      surtidoPct: 100,
    },
  },
  manufactura: {
    ...emptySection(),
    total: { itemCount: 4, totalInventario: 400_000 },
    demandaD: { itemCount: 1, totalInventario: 100_000, diasInventario: 8 },
    ceroRotacion: {
      itemCount: 2,
      sinVerificar: 1,
      seguimiento: 1,
      surtido: 0,
      surtidoPct: 0,
    },
    restockS: {
      itemCount: 1,
      sinVerificar: 0,
      seguimiento: 1,
      surtido: 0,
      surtidoPct: 0,
    },
  },
  restockEffectiveness: {
    score: 50,
    markedSurtidoCount: 2,
    soldAfterCount: 1,
    unavailable: false,
  },
  ...overrides,
});

describe("critical-digest-consolidated-email", () => {
  it("agrega totales de cadena y score restock ponderado", () => {
    const digests = [
      digestFor({
        sedeName: "Floresta",
        sedeId: "001",
        total: { itemCount: 10, totalInventario: 1_000_000 },
        // 0=5, S=2 → D=3
        restockEffectiveness: {
          score: 50,
          markedSurtidoCount: 2,
          soldAfterCount: 1,
          unavailable: false,
        },
      }),
      digestFor({
        sedeName: "Palmira",
        sedeId: "002",
        empresa: "mmio",
        total: { itemCount: 7, totalInventario: 500_000 },
        // mismas familias 0=5 S=2 → D=0
        restockEffectiveness: {
          score: 100,
          markedSurtidoCount: 1,
          soldAfterCount: 1,
          unavailable: false,
        },
      }),
    ];

    const totals = aggregateConsolidatedDigestTotals(digests);
    assert.equal(totals.itemCount, 17);
    assert.equal(totals.totalInventario, 1_500_000);
    assert.equal(totals.restockMarked, 3);
    assert.equal(totals.restockSold, 2);
    assert.equal(totals.restockScore, 67);
    assert.equal(totals.demandaD, 3); // 10-5-2 + max(0,7-5-2)=3+0
    assert.equal(totals.cero, 10);
    assert.equal(totals.restockS, 4);
  });

  it("genera asunto, HTML y texto con tabla por sede", () => {
    const digests = [
      digestFor({ sedeName: "Calle 5ta", sedeId: "010" }),
      digestFor({ sedeName: "Floresta", sedeId: "001" }),
    ];

    const subject = buildRotacionCriticalDigestConsolidatedSubject(digests);
    assert.match(subject, /Todas las sedes/);
    assert.match(subject, /Críticos/);

    const html = buildRotacionCriticalDigestConsolidatedHtml(digests);
    assert.match(html, /Comparativo por sede/);
    assert.match(html, /Calle 5ta/);
    assert.match(html, /Floresta/);
    assert.match(html, /Desglose por familia/);
    assert.match(html, /#be123c/);
    assert.match(html, /Total cadena D\+0\+S/);

    const text = buildRotacionCriticalDigestConsolidatedText(digests);
    assert.match(text, /TOTAL CADENA/);
    assert.match(text, /SEDE \| RESTOCK/);
    assert.match(text, /Floresta/);
    assert.match(text, /Calle 5ta/);
  });
});
