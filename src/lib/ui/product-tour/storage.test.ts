import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTourLocalStorageKey,
  isTourCompletedLocally,
  markTourCompletedLocally,
} from "./storage";

const BASE = "portal:tutorial:test:v1";
const USER = "user-abc";

test("buildTourLocalStorageKey agrega sufijo de usuario", () => {
  assert.equal(buildTourLocalStorageKey(BASE, USER), `${BASE}.${USER}`);
  assert.equal(buildTourLocalStorageKey(BASE, null), BASE);
});

test("isTourCompletedLocally reconoce clave legacy sin userId", () => {
  const storage = new Map<string, string>();
  const original = globalThis.localStorage;

  Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
  });

  try {
    markTourCompletedLocally(BASE, undefined);
    assert.equal(isTourCompletedLocally(BASE, USER), true);

    storage.clear();
    markTourCompletedLocally(BASE, USER);
    assert.equal(isTourCompletedLocally(BASE, USER), true);
    assert.equal(isTourCompletedLocally(BASE, "otro-user"), false);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  }
});
