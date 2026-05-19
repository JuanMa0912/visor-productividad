import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
  normalizeAllowedPortalSubsections,
} from "./portal-sections";
import {
  canAccessRotacionBoard,
  canAccessRotacionV4Board,
} from "./special-role-features";

test("empty portal permission lists mean all sections and subdashboards", () => {
  assert.equal(canAccessPortalSection([], "producto"), true);
  assert.equal(canAccessPortalSubsection([], "rotacion"), true);
  assert.equal(normalizeAllowedPortalSubsections([]), null);
});

test("explicit subdashboard selection grants rotacion without legacy special role", () => {
  assert.equal(canAccessRotacionBoard(null, false, ["rotacion"]), true);
  assert.equal(canAccessRotacionBoard([], false, ["rotacion"]), true);
});

test("explicit subdashboard restriction blocks rotacion even with legacy special role", () => {
  assert.equal(canAccessRotacionBoard(["rotacion"], false, ["margenes"]), false);
});

test("legacy rotacion special role still works when subdashboard data is not provided", () => {
  assert.equal(canAccessRotacionBoard(["rotacion"], false), true);
  assert.equal(canAccessRotacionBoard(null, false), false);
});

test("rotacion v4 is admin-only", () => {
  assert.equal(canAccessRotacionV4Board(true), true);
  assert.equal(canAccessRotacionV4Board(false), false);
});
