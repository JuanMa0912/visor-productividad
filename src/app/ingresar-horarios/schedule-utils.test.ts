import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reindexRowMapAfterRemoval,
  reindexRowRecordAfterRemoval,
} from "./schedule-utils";

describe("reindexRowMapAfterRemoval", () => {
  it("elimina la fila y sube indices posteriores", () => {
    const source = new Map([
      [0, new Set(["lunes"])],
      [2, new Set(["martes"])],
      [3, new Set(["miercoles"])],
    ]);
    const next = reindexRowMapAfterRemoval(source, 1);
    assert.equal(next.size, 3);
    assert.deepEqual([...next.get(0)!], ["lunes"]);
    assert.deepEqual([...next.get(1)!], ["martes"]);
    assert.deepEqual([...next.get(2)!], ["miercoles"]);
  });
});

describe("reindexRowRecordAfterRemoval", () => {
  it("reindexa presets por fila tras borrar una intermedia", () => {
    const next = reindexRowRecordAfterRemoval(
      { 0: "1", 2: "2", 4: "3" },
      2,
    );
    assert.deepEqual(next, { 0: "1", 3: "3" });
  });
});
