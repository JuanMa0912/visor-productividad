import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIN_IDLE_QUERY,
  SESSION_IDLE_MINUTES,
  SESSION_IDLE_MS,
  isSessionIdle,
  loginUrlAfterIdle,
} from "./session-idle";

describe("cierre de sesion por inactividad", () => {
  it("espera 60 minutos exactos sin actividad", () => {
    assert.equal(SESSION_IDLE_MINUTES, 60);
    assert.equal(SESSION_IDLE_MS, 60 * 60 * 1000);
  });

  it("no esta idle si hubo actividad reciente", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(isSessionIdle(now - 10 * 60 * 1000, now), false);
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS + 1, now), false);
  });

  it("esta idle al cumplirse el minuto 60", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS, now), true);
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS - 1, now), true);
    assert.equal(isSessionIdle(0, now), true);
  });

  it("manda al login con razon de inactividad", () => {
    assert.equal(loginUrlAfterIdle(), `/login?razon=${LOGIN_IDLE_QUERY}`);
  });
});
