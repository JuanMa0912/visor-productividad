import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveProductivityCacheMaxAgeMs,
  shouldServeProductivityFileCache,
} from "@/lib/productivity/file-cache-policy";

describe("productivity file-cache policy", () => {
  it("sirve cache reciente por defecto y respeta force/false", () => {
    const nowMs = Date.parse("2026-07-28T16:00:00.000Z");
    const fresh = "2026-07-28T14:00:00.000Z";
    const stale = "2026-07-27T10:00:00.000Z";
    const maxAgeMs = resolveProductivityCacheMaxAgeMs(undefined);

    assert.equal(
      shouldServeProductivityFileCache(fresh, false, { nowMs, maxAgeMs }),
      true,
    );
    assert.equal(
      shouldServeProductivityFileCache(stale, false, { nowMs, maxAgeMs }),
      false,
    );
    assert.equal(
      shouldServeProductivityFileCache(fresh, true, { nowMs, maxAgeMs }),
      false,
    );
    assert.equal(
      shouldServeProductivityFileCache(stale, false, {
        nowMs,
        maxAgeMs,
        flag: "true",
      }),
      true,
    );
    assert.equal(
      shouldServeProductivityFileCache(fresh, false, {
        nowMs,
        maxAgeMs,
        flag: "false",
      }),
      false,
    );
  });
});
