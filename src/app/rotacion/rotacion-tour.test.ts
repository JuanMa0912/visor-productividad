import assert from "node:assert/strict";
import { test } from "node:test";
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
