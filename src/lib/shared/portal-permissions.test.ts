import assert from "node:assert/strict";
import test from "node:test";
import {
  canAccessPortalSection,
  canAccessPortalSubsection,
  encodePortalPermissionSelection,
  expandPortalPermissionSelectionForForm,
  isAdminOnlyPortalSubsection,
  listAssignablePortalSubsectionIds,
  normalizeAllowedPortalSubsections,
  OPT_IN_PORTAL_SUBSECTIONS,
} from "./portal-sections";
import {
  canAccessOrdenesCompra,
  canAccessPreciosProveedor,
  canAccessProveedoresBoard,
  canAccessRotacionBoard,
  canViewProveedoresQrLinks,
} from "./special-role-features";

test("lista JSON en string no se interpreta como todas las secciones", () => {
  assert.deepEqual(
    normalizeAllowedPortalSubsections('["rotacion","margenes"]'),
    ["rotacion", "margenes"],
  );
  assert.equal(canAccessPortalSubsection('["rotacion"]', "rotacion"), true);
  assert.equal(canAccessPortalSubsection('["rotacion"]', "margenes"), false);
  assert.equal(canAccessPortalSubsection("{mal}", "rotacion"), false);
  assert.equal(canAccessPortalSection("{mal}", "producto"), false);
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

test("ordenes-compra es opt-in: null no lo concede; admin o venta + subtablero", () => {
  assert.equal(canAccessPortalSubsection(null, "ordenes-compra"), false);
  assert.equal(canAccessPortalSubsection([], "ordenes-compra"), false);
  assert.equal(
    canAccessPortalSubsection(["proveedores"], "ordenes-compra"),
    false,
  );
  assert.equal(
    canAccessPortalSubsection(["ordenes-compra"], "ordenes-compra"),
    true,
  );
  assert.equal(isAdminOnlyPortalSubsection("ordenes-compra"), false);
  assert.equal(
    listAssignablePortalSubsectionIds().includes("ordenes-compra"),
    true,
  );

  assert.equal(canAccessOrdenesCompra("admin", [], []), true);
  assert.equal(canAccessOrdenesCompra("user", null, null), false);
  assert.equal(canAccessOrdenesCompra("user", ["venta"], null), false);
  assert.equal(canAccessOrdenesCompra("user", ["venta"], []), false);
  assert.equal(
    canAccessOrdenesCompra("user", ["venta"], ["ordenes-compra"]),
    true,
  );
  assert.equal(
    canAccessOrdenesCompra("user", ["producto"], ["ordenes-compra"]),
    false,
  );
});

test("precios-proveedor es opt-in: null no lo concede", () => {
  assert.equal(canAccessPortalSubsection(null, "precios-proveedor"), false);
  assert.equal(canAccessPortalSubsection([], "precios-proveedor"), false);
  assert.equal(
    canAccessPortalSubsection(["proveedores"], "precios-proveedor"),
    false,
  );
  assert.equal(
    canAccessPortalSubsection(["precios-proveedor"], "precios-proveedor"),
    true,
  );
  assert.equal(canAccessPortalSubsection(null, "proveedores"), true);
});

test("canAccessPreciosProveedor: admin o venta + subtablero explícito", () => {
  assert.equal(canAccessPreciosProveedor("admin", [], []), true);
  assert.equal(canAccessPreciosProveedor("user", null, null), false);
  assert.equal(canAccessPreciosProveedor("user", ["venta"], null), false);
  assert.equal(canAccessPreciosProveedor("user", ["venta"], []), false);
  assert.equal(
    canAccessPreciosProveedor("user", ["venta"], ["precios-proveedor"]),
    true,
  );
  assert.equal(
    canAccessPreciosProveedor("user", ["producto"], ["precios-proveedor"]),
    false,
  );
});

test("encode/expand no marca precios-proveedor cuando null = todos", () => {
  const allIds = listAssignablePortalSubsectionIds();
  const expanded = expandPortalPermissionSelectionForForm(
    null,
    allIds,
    OPT_IN_PORTAL_SUBSECTIONS,
  );
  assert.equal(expanded.includes("precios-proveedor"), false);
  assert.equal(expanded.includes("ordenes-compra"), false);
  assert.equal(expanded.includes("proveedores"), true);

  assert.equal(
    encodePortalPermissionSelection(expanded, allIds, OPT_IN_PORTAL_SUBSECTIONS),
    null,
  );

  const withOptIn = [
    ...expanded,
    "precios-proveedor",
    "ordenes-compra",
  ] as typeof expanded;
  const encoded = encodePortalPermissionSelection(
    withOptIn,
    allIds,
    OPT_IN_PORTAL_SUBSECTIONS,
  );
  assert.ok(Array.isArray(encoded));
  assert.equal(encoded?.includes("precios-proveedor"), true);
  assert.equal(encoded?.includes("ordenes-compra"), true);
  assert.equal(encoded?.includes("proveedores"), true);
});
