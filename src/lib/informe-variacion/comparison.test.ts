import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { informePayloadHasComparisonData } from "./comparison";
import { r } from "./test-row";

describe("informePayloadHasComparisonData", () => {
  it("detecta filas sin bases de comparacion", () => {
    assert.equal(informePayloadHasComparisonData([r(0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0)]), false);
  });

  it("detecta bases MoM o YoY", () => {
    assert.equal(
      informePayloadHasComparisonData([r(0, 0, 0, 0, 0, 100, 10, 0, 0, 0, 0)]),
      true,
    );
    assert.equal(
      informePayloadHasComparisonData([r(0, 0, 0, 0, 0, 100, 0, 0, 0, 5, 0)]),
      true,
    );
  });
});
