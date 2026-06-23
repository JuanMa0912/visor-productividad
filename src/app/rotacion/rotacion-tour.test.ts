import assert from "node:assert/strict";
import { test } from "node:test";
import { ROTACION_TOUR_ANCHOR } from "./rotacion-tour-anchors";
import { ROTACION_TOUR_STEPS } from "./rotacion-tour-steps";
import {
  ROTACION_TOUR_STORAGE_KEY,
  buildRotacionTourStorageKey,
} from "./rotacion-tour";

test("buildRotacionTourStorageKey separa usuarios en el mismo navegador", () => {
  assert.equal(
    buildRotacionTourStorageKey("user-a"),
    `${ROTACION_TOUR_STORAGE_KEY}.user-a`,
  );
  assert.equal(
    buildRotacionTourStorageKey("user-b"),
    `${ROTACION_TOUR_STORAGE_KEY}.user-b`,
  );
  assert.notEqual(
    buildRotacionTourStorageKey("user-a"),
    buildRotacionTourStorageKey("user-b"),
  );
});

test("buildRotacionTourStorageKey sin usuario usa clave base", () => {
  assert.equal(
    buildRotacionTourStorageKey(null),
    ROTACION_TOUR_STORAGE_KEY,
  );
});

test("ROTACION_TOUR_ANCHOR tiene ids unicos", () => {
  const values = Object.values(ROTACION_TOUR_ANCHOR);
  assert.equal(new Set(values).size, values.length);
});

test("ROTACION_TOUR_STEPS referencia solo anclas declaradas", () => {
  const anchorIds = new Set(Object.values(ROTACION_TOUR_ANCHOR));
  for (const step of ROTACION_TOUR_STEPS) {
    const selector = step.element;
    assert.equal(typeof selector, "string");
    const id = (selector as string).slice(1);
    assert.ok(
      anchorIds.has(id as (typeof ROTACION_TOUR_ANCHOR)[keyof typeof ROTACION_TOUR_ANCHOR]),
      `selector huérfano: ${selector}`,
    );
    assert.ok(step.popover?.title, `paso sin título: ${selector}`);
    assert.ok(step.popover?.description, `paso sin descripción: ${selector}`);
  }
});
