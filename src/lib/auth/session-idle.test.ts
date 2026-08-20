import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOGIN_IDLE_QUERY,
  SESSION_IDLE_MINUTES,
  SESSION_IDLE_MS,
  isSessionIdle,
  loginUrlAfterIdle,
  shouldRecordActivity,
  shouldResetIdleClockOnAuthChange,
} from "./session-idle";

describe("cierre de sesion por inactividad", () => {
  it("espera 5 minutos exactos sin actividad", () => {
    assert.equal(SESSION_IDLE_MINUTES, 5);
    assert.equal(SESSION_IDLE_MS, 5 * 60 * 1000);
  });

  it("no esta idle si hubo actividad reciente", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(isSessionIdle(now - 2 * 60 * 1000, now), false);
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS + 1, now), false);
  });

  it("esta idle al cumplirse el minuto 5", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS, now), true);
    assert.equal(isSessionIdle(now - SESSION_IDLE_MS - 1, now), true);
    assert.equal(isSessionIdle(0, now), true);
  });

  it("no deja que un gesto posterior reviva una sesion ya idle", () => {
    const now = Date.parse("2026-08-19T12:00:00.000Z");
    assert.equal(shouldRecordActivity(now - 60 * 1000, now), true);
    assert.equal(shouldRecordActivity(now - SESSION_IDLE_MS, now), false);
    assert.equal(shouldRecordActivity(now - SESSION_IDLE_MS - 1, now), false);
  });

  it("manda al login con razon de inactividad", () => {
    assert.equal(loginUrlAfterIdle(), `/login?razon=${LOGIN_IDLE_QUERY}`);
  });

  it("reinicia el reloj idle solo al pasar a autenticado", () => {
    assert.equal(shouldResetIdleClockOnAuthChange(false, true), true);
    assert.equal(shouldResetIdleClockOnAuthChange(true, true), false);
    assert.equal(shouldResetIdleClockOnAuthChange(true, false), false);
    assert.equal(shouldResetIdleClockOnAuthChange(false, false), false);
  });
});
