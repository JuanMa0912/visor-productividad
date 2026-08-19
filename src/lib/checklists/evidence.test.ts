import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  missingChecklistPhotoKeys,
  parseChecklistSignature,
  requiresChecklistPhoto,
} from "@/lib/checklists/evidence";

describe("checklist evidence", () => {
  it("P y NC exigen foto; C y NA no", () => {
    assert.equal(requiresChecklistPhoto("P"), true);
    assert.equal(requiresChecklistPhoto("NC"), true);
    assert.equal(requiresChecklistPhoto("C"), false);
    assert.equal(requiresChecklistPhoto("NA"), false);
    assert.equal(requiresChecklistPhoto(1), false);
  });

  it("lista ítems P/NC sin foto guardada", () => {
    const missing = missingChecklistPhotoKeys(
      {
        "4": { v: "NC" },
        "5": { v: "P" },
        "6": { v: "C" },
      },
      ["4"],
    );
    assert.deepEqual(missing, ["5"]);
  });

  it("rechaza firma vacía y acepta un PNG con payload", () => {
    assert.equal(parseChecklistSignature("").ok, false);
    const payload = `data:image/png;base64,${"A".repeat(1600)}`;
    const parsed = parseChecklistSignature(payload);
    assert.equal(parsed.ok, true);
  });
});
