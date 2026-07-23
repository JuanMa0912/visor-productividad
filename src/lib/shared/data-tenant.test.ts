import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveDataSourceKind,
  userIsDinastiaOnly,
  userHasDinastiaAccess,
  canonicalizeEmpresaCode,
  resolveEmpresasHintForTenant,
  stripDinastiaSedeKeys,
} from "./data-tenant";

describe("data-tenant", () => {
  it("canoniza aliases de empresa", () => {
    assert.equal(canonicalizeEmpresaCode("Mercatodo"), "mtodo");
    assert.equal(canonicalizeEmpresaCode("DINASTÍA"), "dinastia");
  });

  it("usuario solo dinastia", () => {
    const user = { role: "user" as const, allowedEmpresas: ["dinastia"] };
    assert.equal(userIsDinastiaOnly(user), true);
    assert.equal(userHasDinastiaAccess(user), true);
    const resolved = resolveDataSourceKind(user, []);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.kind, "dinastia");
  });

  it("admin con Todas usa default (no mezcla Dinastia)", () => {
    const resolved = resolveDataSourceKind({ role: "admin" }, []);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.kind, "default");
  });

  it("admin eligiendo solo Dinastia usa tablas dinastia", () => {
    const resolved = resolveDataSourceKind({ role: "admin" }, ["dinastia"]);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.kind, "dinastia");
  });

  it("rechaza mezcla Dinastia + otras", () => {
    const resolved = resolveDataSourceKind({ role: "admin" }, [
      "dinastia",
      "mercamio",
    ]);
    assert.equal(resolved.ok, false);
  });

  it("usuario sin dinastia no puede seleccionarla", () => {
    const resolved = resolveDataSourceKind(
      { role: "user", allowedEmpresas: ["mercamio"] },
      ["dinastia"],
    );
    assert.equal(resolved.ok, false);
  });

  it("hint desde sedes solo Dinastia", () => {
    assert.deepEqual(
      resolveEmpresasHintForTenant([], ["dinastia|001", "dinastia|002"]),
      ["dinastia"],
    );
  });

  it("hint con mezcla no fuerza Dinastia", () => {
    assert.deepEqual(
      resolveEmpresasHintForTenant([], ["dinastia|001", "mercamio|001"]),
      [],
    );
  });

  it("stripDinastiaSedeKeys en mezcla", () => {
    assert.deepEqual(
      stripDinastiaSedeKeys(["dinastia|001", "mercamio|001"]),
      ["mercamio|001"],
    );
  });
});
