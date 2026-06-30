import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMargenSedesAllowed,
  filterMargenSedeCatalogForUser,
  resolveMargenSedeScope,
} from "@/lib/margenes/margen-sede-scope";

test("admin ve todas las sedes del catálogo", () => {
  const scope = resolveMargenSedeScope({
    role: "admin",
    sede: null,
    allowedSedes: null,
  });
  assert.equal(scope.hasAllSedes, true);
  assert.equal(scope.allowedKeys, null);
  assert.ok(filterMargenSedeCatalogForUser({ role: "admin", sede: null }).length > 5);
});

test("usuario con Floresta solo ve mtodo|001", () => {
  const user = {
    role: "user" as const,
    sede: null,
    allowedSedes: ["Floresta"],
  };
  const scope = resolveMargenSedeScope(user);
  assert.equal(scope.authorized, true);
  assert.deepEqual(scope.allowedKeys, ["mtodo|001"]);

  const catalog = filterMargenSedeCatalogForUser(user);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.label, "Floresta");

  const denied = assertMargenSedesAllowed(["mercamio|001"], user);
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false ? denied.status : null, 403);

  const allowed = assertMargenSedesAllowed(["mtodo|001"], user);
  assert.equal(allowed.ok, true);
});

test("Todas mantiene catálogo completo para no admin", () => {
  const user = {
    role: "user" as const,
    sede: null,
    allowedSedes: ["Todas"],
  };
  const scope = resolveMargenSedeScope(user);
  assert.equal(scope.hasAllSedes, true);
  assert.equal(scope.allowedKeys, null);
});

test("legacy sede restringe catálogo", () => {
  const user = {
    role: "user" as const,
    sede: "Palmira",
    allowedSedes: null,
  };
  const scope = resolveMargenSedeScope(user);
  assert.deepEqual(scope.allowedKeys, ["mercamio|006"]);
});
