import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
  normalizeAllowedPortalSubsections,
} from "./portal-sections";
import { canAccessRotacionBoard } from "./special-role-features";

test("empty portal permission lists mean all sections and subdashboards", () => {
  assert.equal(canAccessPortalSection([], "producto"), true);
  assert.equal(canAccessPortalSubsection([], "rotacion"), true);
  assert.equal(normalizeAllowedPortalSubsections([]), null);
});

test("explicit subdashboard selection grants rotacion", () => {
  assert.equal(canAccessRotacionBoard(null, false, ["rotacion"]), true);
  assert.equal(canAccessRotacionBoard([], false, ["rotacion"]), true);
});

test("explicit subdashboard restriction blocks rotacion", () => {
  assert.equal(canAccessRotacionBoard(["rotacion"], false, ["margenes"]), false);
});

test("sin allowedSubdashboards no hay acceso (ya no hay rol especial rotacion)", () => {
  assert.equal(canAccessRotacionBoard(["rotacion"], false), false);
  assert.equal(canAccessRotacionBoard(null, false), false);
});

test("lista vacia de subtableros = todos (incluye rotacion)", () => {
  assert.equal(canAccessRotacionBoard(null, false, []), true);
  assert.equal(canAccessRotacionBoard(null, false, null), true);
});
