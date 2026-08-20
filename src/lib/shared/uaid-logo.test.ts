import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UAID_LOGO_GRADIENT,
  UAID_LOGO_PATHS,
  UAID_LOGO_STROKE,
} from "./uaid-logo";

describe("uaid logo geometry", () => {
  it("es un cerebro en trazo con contorno y pliegues", () => {
    assert.ok(UAID_LOGO_PATHS.length >= 4);
    assert.ok(UAID_LOGO_STROKE < 2);
    for (const path of UAID_LOGO_PATHS) {
      assert.match(path, /^M/);
    }
    assert.match(UAID_LOGO_PATHS[0], /Z$/);
  });

  it("usa la paleta cielo-azul-índigo del login UAID", () => {
    assert.deepEqual(
      UAID_LOGO_GRADIENT.map((stop) => stop.color),
      ["#38bdf8", "#2563eb", "#4338ca"],
    );
  });
});
