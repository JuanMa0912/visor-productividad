import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UAID_LOGO_DOT,
  UAID_LOGO_GRADIENT,
  UAID_LOGO_U_PATH,
  UAID_LOGO_U_STROKE,
} from "./uaid-logo";

describe("uaid logo geometry", () => {
  it("es una U fina con un solo punto de dato", () => {
    assert.match(UAID_LOGO_U_PATH, /^M10\.6 /);
    assert.ok(UAID_LOGO_U_STROKE < 2);
    assert.equal(UAID_LOGO_DOT.cx, 16);
    assert.ok(UAID_LOGO_DOT.r <= 1.2);
  });

  it("usa la paleta cielo-azul-índigo del login UAID", () => {
    assert.deepEqual(
      UAID_LOGO_GRADIENT.map((stop) => stop.color),
      ["#38bdf8", "#2563eb", "#4338ca"],
    );
  });
});
