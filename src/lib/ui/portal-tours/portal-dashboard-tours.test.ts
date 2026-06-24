import assert from "node:assert/strict";
import { test } from "node:test";
import { INVENTARIO_X_ITEM_TOUR_ANCHOR } from "./inventario-x-item-tour-anchors";
import { INVENTARIO_X_ITEM_TOUR_STEPS } from "./inventario-x-item-tour-steps";
import { MARGENES_TOUR_ANCHOR } from "./margenes-tour-anchors";
import { MARGENES_TOUR_STEPS } from "./margenes-tour-steps";
import { VENTAS_X_ITEM_TOUR_ANCHOR } from "./ventas-x-item-tour-anchors";
import { VENTAS_X_ITEM_TOUR_STEPS } from "./ventas-x-item-tour-steps";

const assertTourAnchors = (
  anchorMap: Record<string, string>,
  steps: { element?: string | Element | (() => Element) }[],
) => {
  const values = Object.values(anchorMap);
  assert.equal(new Set(values).size, values.length, "ids de ancla duplicados");

  const anchorIds = new Set(values);
  for (const step of steps) {
    const selector = step.element;
    assert.equal(typeof selector, "string", "cada paso debe usar selector string");
    const id = (selector as string).replace(/^#/, "");
    assert.ok(anchorIds.has(id), `ancla no declarada: ${id}`);
  }
};

test("VENTAS_X_ITEM_TOUR tiene anclas unicas y pasos validos", () => {
  assertTourAnchors(VENTAS_X_ITEM_TOUR_ANCHOR, VENTAS_X_ITEM_TOUR_STEPS);
});

test("INVENTARIO_X_ITEM_TOUR tiene anclas unicas y pasos validos", () => {
  assertTourAnchors(INVENTARIO_X_ITEM_TOUR_ANCHOR, INVENTARIO_X_ITEM_TOUR_STEPS);
});

test("MARGENES_TOUR tiene anclas unicas y pasos validos", () => {
  assertTourAnchors(MARGENES_TOUR_ANCHOR, MARGENES_TOUR_STEPS);
});
