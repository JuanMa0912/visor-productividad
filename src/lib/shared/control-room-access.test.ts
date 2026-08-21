import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTROL_ROOM_MODULES } from "@/components/portal/portal-control-room";
import {
  canSeeControlRoomModule,
  filterControlRoomModules,
  type ControlRoomAccessInput,
} from "./control-room-access";

const base = (
  extra: Partial<ControlRoomAccessInput> = {},
): ControlRoomAccessInput => ({
  role: "user",
  isAdmin: false,
  allowedDashboards: ["venta", "producto", "operacion"],
  allowedSubdashboards: null,
  specialRoles: null,
  visibleSectionIds: ["venta", "producto", "operacion"],
  ...extra,
});

const moduleById = (id: string) => {
  const found = CONTROL_ROOM_MODULES.find((entry) => entry.id === id);
  assert.ok(found, `falta el modulo ${id} en CONTROL_ROOM_MODULES`);
  return found;
};

describe("catalogo de sala de control", () => {
  it("incluye costos, OC y checklists con las rutas actuales", () => {
    assert.equal(moduleById("precios-proveedor").href, "/costos");
    assert.equal(moduleById("ordenes-compra").href, "/ordenes-compra");
    assert.equal(moduleById("checklists").href, "/checklists");
    assert.equal(moduleById("informe-variacion").href, "/informe-variacion");
    assert.equal(moduleById("analisis-de-inventario").href, "/analisis-de-inventario");
    assert.equal(
      CONTROL_ROOM_MODULES.some((entry) => entry.id === "ventas-x-item"),
      false,
    );
    assert.equal(
      CONTROL_ROOM_MODULES.some((entry) => entry.id === "inventario-x-item"),
      false,
    );
  });
});

describe("accesos de sala de control", () => {
  it("admin ve costos, OC, rotacion e informe", () => {
    const admin = base({ role: "admin", isAdmin: true });
    assert.equal(canSeeControlRoomModule(moduleById("precios-proveedor"), admin), true);
    assert.equal(canSeeControlRoomModule(moduleById("ordenes-compra"), admin), true);
    assert.equal(canSeeControlRoomModule(moduleById("rotacion"), admin), true);
    assert.equal(canSeeControlRoomModule(moduleById("informe-variacion"), admin), true);
    assert.equal(canSeeControlRoomModule(moduleById("horarios-comparar"), admin), true);
  });

  it("null de subtableros no concede costos ni OC", () => {
    const user = base({ allowedSubdashboards: null });
    assert.equal(canSeeControlRoomModule(moduleById("precios-proveedor"), user), false);
    assert.equal(canSeeControlRoomModule(moduleById("ordenes-compra"), user), false);
    assert.equal(canSeeControlRoomModule(moduleById("analisis-de-inventario"), user), true);
    assert.equal(canSeeControlRoomModule(moduleById("checklists"), user), true);
  });

  it("costos y OC son opt-in explicito", () => {
    const user = base({
      allowedSubdashboards: ["precios-proveedor", "ordenes-compra"],
    });
    assert.equal(canSeeControlRoomModule(moduleById("precios-proveedor"), user), true);
    assert.equal(canSeeControlRoomModule(moduleById("ordenes-compra"), user), true);
  });

  it("comparar horarios exige el rol especial", () => {
    const without = base({ allowedSubdashboards: ["planilla-vs-asistencia"] });
    const withRole = base({
      allowedSubdashboards: ["planilla-vs-asistencia"],
      specialRoles: ["comparar_horarios"],
    });
    assert.equal(
      canSeeControlRoomModule(moduleById("horarios-comparar"), without),
      false,
    );
    assert.equal(
      canSeeControlRoomModule(moduleById("horarios-comparar"), withRole),
      true,
    );
  });

  it("oculta módulos de secciones que el usuario no tiene", () => {
    const onlyVenta = base({ visibleSectionIds: ["venta"] });
    assert.equal(canSeeControlRoomModule(moduleById("analisis-de-inventario"), onlyVenta), true);
    assert.equal(canSeeControlRoomModule(moduleById("margenes"), onlyVenta), false);
    assert.equal(canSeeControlRoomModule(moduleById("checklists"), onlyVenta), false);
  });

  it("el tablero de Días de inventario cubre cualquiera de las 3 pestañas", () => {
    const onlyVentas = base({ allowedSubdashboards: ["ventas-x-item"] });
    const onlyMix = base({ allowedSubdashboards: ["participacion-comercial"] });
    assert.equal(
      canSeeControlRoomModule(moduleById("analisis-de-inventario"), onlyVentas),
      true,
    );
    assert.equal(
      canSeeControlRoomModule(moduleById("analisis-de-inventario"), onlyMix),
      false,
    );

    const filtered = filterControlRoomModules(CONTROL_ROOM_MODULES, onlyVentas);
    const board = filtered.find((entry) => entry.id === "analisis-de-inventario");
    assert.equal(board?.href, "/ventas-x-item");
  });
});
