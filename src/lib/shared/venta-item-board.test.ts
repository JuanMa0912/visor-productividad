import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessVentaItemBoard,
  firstVentaItemBoardHref,
  visibleVentaItemBoardTabs,
} from "./venta-item-board";

describe("tablero unificado de venta por ítem", () => {
  it("concede el tablero si hay cualquiera de las 3 pestañas", () => {
    assert.equal(canAccessVentaItemBoard(false, null), true);
    assert.equal(canAccessVentaItemBoard(false, ["ventas-x-item"]), true);
    assert.equal(canAccessVentaItemBoard(false, ["inventario-x-item"]), true);
    assert.equal(
      canAccessVentaItemBoard(false, ["analisis-de-inventario"]),
      true,
    );
    assert.equal(
      canAccessVentaItemBoard(false, ["participacion-comercial"]),
      false,
    );
    assert.equal(canAccessVentaItemBoard(true, ["participacion-comercial"]), true);
  });

  it("abre la primera pestaña permitida y conserva las URLs", () => {
    assert.equal(firstVentaItemBoardHref(true, ["ventas-x-item"]), "/analisis-de-inventario");
    assert.equal(
      firstVentaItemBoardHref(false, ["ventas-x-item"]),
      "/ventas-x-item",
    );
    assert.equal(
      firstVentaItemBoardHref(false, ["inventario-x-item", "ventas-x-item"]),
      "/inventario-x-item",
    );
    assert.equal(
      firstVentaItemBoardHref(false, null),
      "/analisis-de-inventario",
    );
  });

  it("oculta pestañas sin subtablero", () => {
    const tabs = visibleVentaItemBoardTabs((id) => id === "inventario-x-item");
    assert.deepEqual(
      tabs.map((tab) => tab.id),
      ["inventario-x-item"],
    );
  });
});
