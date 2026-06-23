import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROTACION_TUTORIAL_STATE_KEY,
  readRotacionTutorialCompletedFromState,
} from "@/lib/rotacion/tutorial-state";

test("readRotacionTutorialCompletedFromState reconoce tutorial completado", () => {
  assert.equal(
    readRotacionTutorialCompletedFromState({
      [ROTACION_TUTORIAL_STATE_KEY]: true,
    }),
    true,
  );
  assert.equal(readRotacionTutorialCompletedFromState({}), false);
  assert.equal(readRotacionTutorialCompletedFromState(null), false);
});
