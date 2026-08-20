import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UAID_LOGO_EDGES,
  UAID_LOGO_GRADIENT,
  UAID_LOGO_NODES,
  UAID_LOGO_U_PATH,
  uaidLogoEdgePoints,
} from "./uaid-logo";

describe("uaid logo geometry", () => {
  it("tiene una U cerrada en el viewBox 32 y una red de 3 nodos", () => {
    assert.match(UAID_LOGO_U_PATH, /^M10 /);
    assert.equal(UAID_LOGO_NODES.length, 3);
    assert.equal(UAID_LOGO_EDGES.length, 2);
    for (const [from, to] of UAID_LOGO_EDGES) {
      assert.ok(UAID_LOGO_NODES[from]);
      assert.ok(UAID_LOGO_NODES[to]);
    }
    assert.equal(uaidLogoEdgePoints().length, UAID_LOGO_EDGES.length);
  });

  it("usa la paleta cielo-azul-índigo del login UAID", () => {
    assert.deepEqual(
      UAID_LOGO_GRADIENT.map((stop) => stop.color),
      ["#38bdf8", "#2563eb", "#4338ca"],
    );
  });
});
