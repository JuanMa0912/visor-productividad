import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
  isAdminOnlyPortalSubsection,
  normalizeAllowedPortalSubsections,
} from "./portal-sections";
import {
  canAccessProveedoresBoard,
  canAccessRotacionBoard,
  canViewProveedoresQrLinks,
} from "./special-role-features";

test("empty portal permission lists mean no sections and subdashboards", () => {
  assert.equal(canAccessPortalSection([], "producto"), false);
  assert.equal(canAccessPortalSubsection([], "rotacion"), false);
  assert.deepEqual(normalizeAllowedPortalSubsections([]), []);
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

test("null de subtableros = todos; [] = ninguno", () => {
  assert.equal(canAccessRotacionBoard(null, false, []), false);
  assert.equal(canAccessRotacionBoard(null, false, null), true);
});

test("proveedores: admin siempre; resto por subtablero", () => {
  assert.equal(canAccessProveedoresBoard(true), true);
  assert.equal(canAccessProveedoresBoard(false), false);
  assert.equal(canAccessProveedoresBoard(false, ["proveedores"]), true);
  assert.equal(canAccessProveedoresBoard(false, ["ventas-x-item"]), false);
  assert.equal(canAccessProveedoresBoard(false, null), true);
  assert.equal(canAccessProveedoresBoard(false, []), false);
});

test("proveedores ya no es subtablero solo-admin", () => {
  assert.equal(isAdminOnlyPortalSubsection("proveedores"), false);
  assert.equal(isAdminOnlyPortalSubsection("participacion-comercial"), false);
  assert.equal(isAdminOnlyPortalSubsection("checklists"), false);
});

test("checklists: admin o subtablero checklists", () => {
  assert.equal(canAccessPortalSubsection(null, "checklists"), true);
  assert.equal(canAccessPortalSubsection([], "checklists"), false);
  assert.equal(canAccessPortalSubsection(["checklists"], "checklists"), true);
  assert.equal(
    canAccessPortalSubsection(["consulta-operativa"], "checklists"),
    false,
  );
});

test("QR proveedores: admin siempre; resto necesita proveedores_qr", () => {
  assert.equal(canViewProveedoresQrLinks(null, true), true);
  assert.equal(canViewProveedoresQrLinks([], false), false);
  assert.equal(canViewProveedoresQrLinks(null, false), false);
  assert.equal(canViewProveedoresQrLinks(["proveedores_qr"], false), true);
  assert.equal(canViewProveedoresQrLinks(["abcd"], false), false);
});
