import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TUTORIAL_LOCAL_STORAGE_KEYS,
  TUTORIAL_STATE_KEYS,
  readTutorialCompletedFromState,
} from "@/lib/ui/tutorial-keys";

test("readTutorialCompletedFromState reconoce claves del portal", () => {
  assert.equal(
    readTutorialCompletedFromState(
      { [TUTORIAL_STATE_KEYS.portalSections]: true },
      TUTORIAL_STATE_KEYS.portalSections,
    ),
    true,
  );
  assert.equal(
    readTutorialCompletedFromState(
      { [TUTORIAL_STATE_KEYS.rotacion]: true },
      TUTORIAL_STATE_KEYS.portalSections,
    ),
    false,
  );
});

test("TUTORIAL_STATE_KEYS y localStorage tienen el mismo cardinal", () => {
  assert.equal(
    Object.keys(TUTORIAL_STATE_KEYS).length,
    Object.keys(TUTORIAL_LOCAL_STORAGE_KEYS).length,
  );
});
