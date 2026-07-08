import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { informePayloadHasComparisonData } from "./comparison";
import type { InformeCompactRow } from "./types";

const emptyRow = (): InformeCompactRow => [0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0];

describe("informePayloadHasComparisonData", () => {
  it("detecta filas sin bases de comparacion", () => {
    assert.equal(informePayloadHasComparisonData([emptyRow()]), false);
  });

  it("detecta bases MoM o YoY", () => {
    const withMom: InformeCompactRow = [0, 0, 0, 0, 0, 100, 10, 0, 0, 0, 0];
    const withYoy: InformeCompactRow = [0, 0, 0, 0, 0, 100, 0, 0, 0, 5, 0];
    assert.equal(informePayloadHasComparisonData([withMom]), true);
    assert.equal(informePayloadHasComparisonData([withYoy]), true);
  });
});
