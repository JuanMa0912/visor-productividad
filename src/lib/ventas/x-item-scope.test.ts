import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVentasSedePairWhereClause,
  resolveVentasXItemScope,
} from "@/lib/ventas/x-item-scope";

describe("resolveVentasXItemScope", () => {
  it("admin sin filtro de empresa ni sede", () => {
    const scope = resolveVentasXItemScope(
      { role: "admin", sede: null },
      [],
    );
    assert.equal(scope.ok, true);
    if (!scope.ok) return;
    assert.equal(scope.empresas, null);
    assert.equal(scope.sedePairs, null);
  });

  it("usuario restringido a mercamio fuerza filtro aunque no pida empresa", () => {
    const scope = resolveVentasXItemScope(
      {
        role: "user",
        sede: null,
        allowedEmpresas: ["mercamio"],
        allowedSedes: ["Todas"],
      },
      [],
    );
    assert.equal(scope.ok, true);
    if (!scope.ok) return;
    assert.deepEqual(scope.empresas, ["mercamio"]);
    assert.ok(scope.sedePairs && scope.sedePairs.length > 0);
    assert.ok(scope.sedePairs.every((pair) => pair.empresa === "mercamio"));
  });

  it("rechaza Dinastia (no cableada en ventas x item)", () => {
    const scope = resolveVentasXItemScope(
      { role: "admin", sede: null },
      ["dinastia"],
    );
    assert.equal(scope.ok, false);
    if (scope.ok) return;
    assert.equal(scope.status, 400);
  });

  it("rechaza empresa fuera de alcance", () => {
    const scope = resolveVentasXItemScope(
      {
        role: "user",
        sede: null,
        allowedEmpresas: ["mercamio"],
        allowedSedes: ["Todas"],
      },
      ["mtodo"],
    );
    assert.equal(scope.ok, false);
    if (scope.ok) return;
    assert.equal(scope.status, 400);
  });
});

describe("buildVentasSedePairWhereClause", () => {
  it("null no agrega filtro; vacio deniega", () => {
    const params: unknown[] = [];
    assert.equal(buildVentasSedePairWhereClause("", params, null), null);
    assert.equal(buildVentasSedePairWhereClause("", params, []), "FALSE");
  });
});
