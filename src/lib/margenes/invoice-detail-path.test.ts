import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drillPathForInvoiceDetail,
  isInvoiceDetailDrillPath,
} from "@/lib/margenes/drill-path";
import {
  factPathToInvoiceKpiDrillPath,
  isInvoiceDetailFactPath,
} from "@/lib/margenes/fact-path";

describe("drillPathForInvoiceDetail", () => {
  it("conserva solo la factura al ver detalle", () => {
    const path = [
      { type: "day" as const, fecha: "20260601", label: "01/06/2026" },
      { type: "tipo" as const, id: "4", label: "MERCADO" },
      { type: "linea1" as const, id: "10", label: "Carnes" },
      { type: "linea2" as const, id: "20", label: "Res" },
      { type: "item" as const, id: "123", label: "Item X" },
      {
        type: "factura" as const,
        documento: "FV-100",
        tipdoc: "01",
        label: "FV-100",
      },
    ];
    assert.deepEqual(drillPathForInvoiceDetail(path), [
      {
        type: "factura",
        documento: "FV-100",
        tipdoc: "01",
        label: "FV-100",
      },
    ]);
    assert.equal(isInvoiceDetailDrillPath(path), true);
  });
});

describe("factPathToInvoiceKpiDrillPath", () => {
  it("arma KPI solo por factura desde lista o navegación", () => {
    const path = [
      { type: "fecha" as const, fecha: "20260601", label: "01/06/2026" },
      { type: "tipo" as const, id: "4", label: "MERCADO" },
      {
        type: "factura" as const,
        documento: "FV-200",
        tipdoc: "01",
        label: "FV-200",
      },
    ];
    assert.equal(isInvoiceDetailFactPath(path), true);
    assert.deepEqual(factPathToInvoiceKpiDrillPath(path), [
      {
        type: "factura",
        documento: "FV-200",
        tipdoc: "01",
        label: "FV-200",
      },
    ]);
    assert.deepEqual(
      factPathToInvoiceKpiDrillPath([
        {
          type: "factura",
          documento: "FV-300",
          tipdoc: "02",
          label: "FV-300",
        },
      ]),
      [
        {
          type: "factura",
          documento: "FV-300",
          tipdoc: "02",
          label: "FV-300",
        },
      ],
    );
  });
});
