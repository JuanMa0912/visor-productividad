import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSharePct,
  nextParticipacionLevel,
  parseParticipacionDrillPath,
  sharePct,
} from "@/lib/participacion-comercial/format";

describe("sharePct", () => {
  it("calcula porcentaje", () => {
    assert.equal(sharePct(25, 100), 25);
    assert.equal(sharePct(0, 100), 0);
    assert.equal(sharePct(10, 0), 0);
  });
});

describe("nextParticipacionLevel", () => {
  it("avanza por sede", () => {
    assert.equal(nextParticipacionLevel("sede", []), "sede");
    assert.equal(
      nextParticipacionLevel("sede", [
        {
          type: "sede",
          id: "mercamio|001",
          label: "Calle 5",
          empresa: "mercamio",
          sedeId: "001",
        },
      ]),
      "almacen",
    );
  });

  it("avanza por linea", () => {
    assert.equal(nextParticipacionLevel("linea", []), "linea");
    assert.equal(
      nextParticipacionLevel("linea", [
        { type: "linea", id: "05", label: "Bebidas" },
      ]),
      "sede",
    );
  });
});

describe("parseParticipacionDrillPath", () => {
  it("parsea JSON", () => {
    const path = parseParticipacionDrillPath(
      JSON.stringify([{ type: "categoria", id: "1", label: "Mercado" }]),
    );
    assert.equal(path.length, 1);
    assert.equal(path[0]?.type, "categoria");
  });

  it("formatea pct", () => {
    assert.match(formatSharePct(12.34), /12[,.]3%/);
  });
});
