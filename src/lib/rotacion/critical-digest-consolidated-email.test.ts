import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RotacionCriticalDigest } from "@/lib/rotacion/critical-digest";
import {
  aggregateConsolidatedDigestTotals,
  buildRotacionCriticalDigestConsolidatedHtml,
  buildRotacionCriticalDigestConsolidatedSubject,
  buildRotacionCriticalDigestConsolidatedText,
  buildSedeManagementSignals,
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
  it("agrega totales de cadena solo manufactura y score restock ponderado", () => {
    const digests = [
      digestFor({
        sedeName: "Floresta",
        sedeId: "001",
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
        restockEffectiveness: {
          score: 100,
          markedSurtidoCount: 1,
          soldAfterCount: 1,
          unavailable: false,
        },
      }),
    ];

    const totals = aggregateConsolidatedDigestTotals(digests);
    // Solo manufactura: 4+4 productos, 400k+400k
    assert.equal(totals.itemCount, 8);
    assert.equal(totals.totalInventario, 800_000);
    assert.equal(totals.restockMarked, 3);
    assert.equal(totals.restockSold, 2);
    assert.equal(totals.restockScore, 67);
    assert.equal(totals.demandaD, 2); // 1+1
    assert.equal(totals.cero, 4); // 2+2
    assert.equal(totals.restockS, 2); // 1+1
  });

  it("genera asunto, HTML y texto sin perecederos", () => {
    const digests = [
      digestFor({ sedeName: "Calle 5ta", sedeId: "010" }),
      digestFor({ sedeName: "Floresta", sedeId: "001" }),
    ];

    const subject = buildRotacionCriticalDigestConsolidatedSubject(digests);
    assert.match(subject, /Todas las sedes/);
    assert.match(subject, /Manufactura/);

    const html = buildRotacionCriticalDigestConsolidatedHtml(digests);
    assert.match(html, /Comparativo/);
    assert.match(html, /Gestión/);
    assert.match(html, /Calle 5ta/);
    assert.match(html, /Floresta/);
    assert.match(html, /Manufactura/);
    assert.match(html, /Días inv\./);
    assert.doesNotMatch(html, /Perec\./);
    assert.doesNotMatch(html, />Perecederos</);
    assert.match(html, /Total cadena/);
    assert.match(html, /Cómo leer/);

    const text = buildRotacionCriticalDigestConsolidatedText(digests);
    assert.match(text, /TOTAL CADENA MANUFACTURA/);
    assert.match(text, /GESTIÓN/);
    assert.match(text, /Floresta/);
    assert.match(text, /Calle 5ta/);
    assert.doesNotMatch(text, /\| P /);
  });

  it("genera focos de gestión cuando hay alertas", () => {
    const digest = digestFor({
      sedeName: "Floresta",
      sedeId: "001",
      restockEffectiveness: {
        score: 20,
        markedSurtidoCount: 5,
        soldAfterCount: 1,
        unavailable: false,
      },
      manufactura: {
        ...emptySection(),
        total: { itemCount: 6, totalInventario: 600_000 },
        demandaD: {
          itemCount: 2,
          totalInventario: 200_000,
          diasInventario: 60,
        },
        ceroRotacion: {
          itemCount: 4,
          sinVerificar: 3,
          seguimiento: 1,
          surtido: 0,
          surtidoPct: 0,
        },
        restockS: {
          itemCount: 1,
          sinVerificar: 1,
          seguimiento: 0,
          surtido: 0,
          surtidoPct: 0,
        },
      },
    });
    const signals = buildSedeManagementSignals(digest);
    assert.ok(signals.focusHints.length >= 1);
    assert.ok(
      signals.focusHints.some((hint) => /Restock|cero|DI|Demanda/i.test(hint)),
    );
    assert.equal(signals.sinVerificarCero, 3);
  });
});
