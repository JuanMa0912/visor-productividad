import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  UAID_LOGO_GRADIENT,
  UAID_LOGO_ORBIT_STROKE,
  UAID_LOGO_ORBITS,
  UAID_LOGO_U_PATH,
  UAID_LOGO_U_STROKE,
  uaidLogoOrbitPaths,
} from "./uaid-logo";

describe("uaid logo geometry", () => {
  it("pone la U en el núcleo y dos órbitas más finas alrededor", () => {
    assert.match(UAID_LOGO_U_PATH, /^M11\.45 /);
    assert.equal(UAID_LOGO_ORBITS.length, 2);
    assert.ok(UAID_LOGO_ORBIT_STROKE < UAID_LOGO_U_STROKE);
    const orbits = uaidLogoOrbitPaths();
    assert.equal(orbits.length, 2);
    for (const path of orbits) {
      assert.match(path, /^M/);
      assert.match(path, /A/);
    }
  });

  it("usa la paleta cielo-azul-índigo del login UAID", () => {
    assert.deepEqual(
      UAID_LOGO_GRADIENT.map((stop) => stop.color),
      ["#38bdf8", "#2563eb", "#4338ca"],
    );
  });
});
