import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyIndustriaVisitDiscount,
  buildQrVisitasUnionSql,
  isUsableProveedorNit,
} from "@/lib/productivity/industria-visit-discount";
import { emptyLineMetrics } from "@/lib/productivity/line-volume";

describe("industria visit discount", () => {
  it("acepta NIT reales y rechaza centinelas", () => {
    assert.equal(isUsableProveedorNit("890.900.943-1"), true);
    assert.equal(isUsableProveedorNit("99999999"), false);
    assert.equal(isUsableProveedorNit(""), false);
    assert.equal(isUsableProveedorNit("12"), false);
  });

  it("arma UNION solo con tablas qr_* de la whitelist", () => {
    const sql = buildQrVisitasUnionSql();
    assert.ok(sql);
    assert.match(sql, /qr_calle_5ta/);
    assert.match(sql, /sede_empresa/);
    assert.doesNotMatch(sql, /DROP TABLE/i);
    assert.doesNotMatch(sql, /qr_[^a-z0-9_]/);
  });

  it("resta Industria solo ese día/sede y no baja de 0", () => {
    const industria = emptyLineMetrics("industria", "Industria");
    industria.volume = 1000;
    industria.hours = 10;
    const fruver = emptyLineMetrics("fruver", "Fruver");
    fruver.volume = 500;
    const otherDay = emptyLineMetrics("industria", "Industria");
    otherDay.volume = 800;

    const byKey = new Map([
      ["2026-08-18|Calle 5ta", industria],
      ["2026-08-18|Calle 5ta|fruver", fruver],
      ["2026-08-17|Calle 5ta", otherDay],
    ]);

    applyIndustriaVisitDiscount(
      [
        {
          fechaDcto: "20260818",
          empresaNorm: "mercamio",
          idCoNorm: "001",
          qty: 120,
        },
        {
          fechaDcto: "20260818",
          empresaNorm: "mercamio",
          idCoNorm: "001",
          qty: 9000,
        },
      ],
      (fecha, sede) => byKey.get(`${fecha}|${sede}`),
      (compact) =>
        `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`,
      (idCo, empresa) =>
        idCo === "001" && empresa === "mercamio" ? "Calle 5ta" : "otra",
    );

    assert.equal(industria.volume, 0);
    assert.equal(industria.hours, 10);
    assert.equal(fruver.volume, 500);
    assert.equal(otherDay.volume, 800);
  });
});
