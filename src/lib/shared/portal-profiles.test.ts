import assert from "node:assert/strict";
import test from "node:test";
import {
  inferPortalProfileFromStoredPermissions,
  materializePortalProfilePermissions,
  mergeAdminPermissionBodyWithCurrent,
  resolveAdminUserPermissionsFromBody,
  validateSedesForPortalProfile,
} from "@/lib/shared/portal-profiles";

test("materializePortalProfilePermissions aplica preset RRHH", () => {
  const permissions = materializePortalProfilePermissions("rrhh");
  assert.equal(permissions.role, "user");
  assert.deepEqual(permissions.allowedDashboards, ["operacion"]);
  // Lista escrita a mano A PROPOSITO: es un centinela de permisos. El preset RRHH
  // concede OPERACION_SUBSECTIONS entera, asi que cualquier subseccion nueva de
  // "operacion" se le otorga sola. Que el test falle obliga a decidir de forma
  // consciente si ese perfil debe verla, en vez de heredarla en silencio.
  // "checklists" se agrego a operacion el 2026-08-10 (568d0a2).
  assert.deepEqual(permissions.allowedSubdashboards, [
    "consulta-operativa",
    "planilla-vs-asistencia",
    "registro-de-horarios",
    "checklists",
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

test("materializePortalProfilePermissions aplica preset Asadero", () => {
  const permissions = materializePortalProfilePermissions("asadero");
  assert.equal(permissions.role, "user");
  assert.deepEqual(permissions.allowedDashboards, ["producto", "operacion"]);
  assert.deepEqual(permissions.allowedLines, ["asadero"]);
  assert.equal(permissions.allowedSubdashboards?.includes("margenes"), true);
  assert.equal(permissions.allowedSubdashboards?.includes("rotacion"), true);
  assert.equal(permissions.allowedSubdashboards?.includes("informe-variacion"), true);
  assert.equal(permissions.specialRoles?.includes("alex"), false);
  assert.equal(permissions.specialRoles?.includes("comparar_horarios"), true);
});

test("materializePortalProfilePermissions aplica preset Fruver", () => {
  const permissions = materializePortalProfilePermissions("fruver");
  assert.equal(permissions.role, "user");
  assert.deepEqual(permissions.allowedDashboards, ["producto", "operacion"]);
  assert.deepEqual(permissions.allowedLines, ["fruver"]);
  assert.equal(permissions.allowedSubdashboards?.includes("margenes"), true);
  assert.equal(permissions.allowedSubdashboards?.includes("rotacion"), true);
  assert.equal(permissions.specialRoles?.includes("alex"), false);
});

test("materializePortalProfilePermissions asadero respeta subconjunto de tableros", () => {
  const permissions = materializePortalProfilePermissions("asadero", {
    allowedDashboards: ["producto"],
    allowedSubdashboards: ["margenes", "rotacion"],
  });
  assert.equal(permissions.portalProfile, "asadero");
  assert.deepEqual(permissions.allowedDashboards, ["producto"]);
  assert.deepEqual(permissions.allowedSubdashboards, ["margenes", "rotacion"]);
  assert.deepEqual(permissions.allowedLines, ["asadero"]);
});

test("materializePortalProfilePermissions personalizado añade seccion padre", () => {
  const permissions = materializePortalProfilePermissions("personalizado", {
    allowedDashboards: ["venta"],
    allowedSubdashboards: ["rotacion"],
  });
  assert.deepEqual(permissions.allowedDashboards, ["venta", "producto"]);
  assert.deepEqual(permissions.allowedSubdashboards, ["rotacion"]);
});

test("materializePortalProfilePermissions personalizado no restringe si secciones vacias", () => {
  const permissions = materializePortalProfilePermissions("personalizado", {
    allowedDashboards: [],
    allowedSubdashboards: ["rotacion"],
  });
  assert.equal(permissions.allowedDashboards, null);
  assert.deepEqual(permissions.allowedSubdashboards, ["rotacion"]);
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

test("mergeAdminPermissionBodyWithCurrent respeta null explicito en subtableros", () => {
  const merged = mergeAdminPermissionBodyWithCurrent(
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedSubdashboards: null,
      allowedDashboards: null,
    },
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedLines: ["asadero"],
      allowedDashboards: ["producto"],
      allowedSubdashboards: ["margenes", "rotacion"],
      specialRoles: ["alex"],
    },
  );
  assert.equal(merged.allowedSubdashboards, null);
  assert.equal(merged.allowedDashboards, null);
  assert.deepEqual(merged.allowedLines, ["asadero"]);
  assert.deepEqual(merged.specialRoles, ["alex"]);
});

test("merge + resolve personalizado puede ampliar a todos los subtableros", () => {
  const merged = mergeAdminPermissionBodyWithCurrent(
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedDashboards: ["producto"],
      allowedSubdashboards: null,
    },
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedLines: null,
      allowedDashboards: ["producto"],
      allowedSubdashboards: ["margenes"],
      specialRoles: null,
    },
  );
  const resolved = resolveAdminUserPermissionsFromBody(merged);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.equal(resolved.value.allowedSubdashboards, null);
});

test("merge + resolve personalizado actualiza subconjunto de subtableros", () => {
  const merged = mergeAdminPermissionBodyWithCurrent(
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedDashboards: ["producto"],
      allowedSubdashboards: ["rotacion"],
    },
    {
      portalProfile: "personalizado",
      allowedSedes: ["Floresta"],
      allowedLines: null,
      allowedDashboards: ["producto"],
      allowedSubdashboards: ["margenes"],
      specialRoles: null,
    },
  );
  const resolved = resolveAdminUserPermissionsFromBody(merged);
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  assert.deepEqual(resolved.value.allowedSubdashboards, ["rotacion"]);
});
