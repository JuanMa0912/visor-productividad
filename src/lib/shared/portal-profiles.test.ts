import assert from "node:assert/strict";
import test from "node:test";
import {
  inferPortalProfileFromStoredPermissions,
  materializePortalProfilePermissions,
  validateSedesForPortalProfile,
} from "@/lib/shared/portal-profiles";

test("materializePortalProfilePermissions aplica preset RRHH", () => {
  const permissions = materializePortalProfilePermissions("rrhh");
  assert.equal(permissions.role, "user");
  assert.deepEqual(permissions.allowedDashboards, ["operacion"]);
  assert.deepEqual(permissions.allowedSubdashboards, [
    "consulta-operativa",
    "planilla-vs-asistencia",
    "registro-de-horarios",
  ]);
  assert.deepEqual(permissions.specialRoles, [
    "alex",
    "comparar_horarios",
    "replicar_lunes",
    "crear_horario_predeterminado",
  ]);
});

test("materializePortalProfilePermissions admin usa role admin", () => {
  const permissions = materializePortalProfilePermissions("admin");
  assert.equal(permissions.role, "admin");
  assert.equal(permissions.allowedDashboards, null);
  assert.equal(permissions.specialRoles, null);
});

test("inferPortalProfileFromStoredPermissions detecta subadmin", () => {
  const profile = inferPortalProfileFromStoredPermissions({
    role: "user",
    allowedDashboards: null,
    allowedSubdashboards: null,
    allowedLines: null,
    specialRoles: [
      "alex",
      "comparar_horarios",
      "replicar_lunes",
      "crear_horario_predeterminado",
      "abcd",
      "historial_sinventario",
    ],
  });
  assert.equal(profile, "subadmin");
});

test("validateSedesForPortalProfile bloquea Todas en gerente", () => {
  assert.equal(
    validateSedesForPortalProfile("gerente", ["Todas"]),
    "El perfil Gerente no puede usar la sede «Todas»; asigna sedes concretas.",
  );
  assert.equal(validateSedesForPortalProfile("gerente", ["Floresta"]), null);
});
