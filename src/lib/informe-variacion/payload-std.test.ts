import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canUseInformePayloadStd } from "@/lib/informe-variacion/payload-std-server";

describe("canUseInformePayloadStd", () => {
  it("solo scope completo sin tipos forzados", () => {
    assert.equal(canUseInformePayloadStd(null, null), true);
    assert.equal(canUseInformePayloadStd(null, []), true);
    assert.equal(canUseInformePayloadStd(["FLORESTA"], null), false);
    assert.equal(canUseInformePayloadStd(null, ["3"]), false);
  });
});
