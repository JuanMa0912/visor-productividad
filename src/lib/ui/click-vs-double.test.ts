import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createClickVsDouble } from "@/lib/ui/click-vs-double";

describe("createClickVsDouble", () => {
  it("el doble clic cancela el simple y no deja correr las dos acciones", () => {
    const queued: Array<{ ms: number; fn: () => void }> = [];
    const click = createClickVsDouble(280, {
      setTimeout: ((fn: () => void, ms?: number) => {
        queued.push({ ms: ms ?? 0, fn });
        return queued.length;
      }) as typeof setTimeout,
      clearTimeout: () => {
        queued.length = 0;
      },
    });

    const ran: string[] = [];
    click.schedule(() => ran.push("simple"));
    click.double(() => ran.push("doble"));
    for (const item of queued) item.fn();

    assert.deepEqual(ran, ["doble"]);
  });

  it("un clic simple sí corre cuando no hay doble", () => {
    const queued: Array<{ fn: () => void }> = [];
    const click = createClickVsDouble(280, {
      setTimeout: ((fn: () => void) => {
        queued.push({ fn });
        return queued.length;
      }) as typeof setTimeout,
      clearTimeout: () => {
        queued.length = 0;
      },
    });

    const ran: string[] = [];
    click.schedule(() => ran.push("simple"));
    for (const item of queued) item.fn();

    assert.deepEqual(ran, ["simple"]);
  });
});
