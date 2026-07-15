import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildUserAuditSnapshot,
  diffUserAuditSnapshots,
  isAuditSensitivePath,
} from "@/lib/admin/user-admin-audit";

describe("user-admin-audit", () => {
  it("detecta cambios de permisos y sedes", () => {
    const before = buildUserAuditSnapshot({
      username: "ana",
      role: "user",
      portalProfile: "gerente",
      sede: "Floresta",
      allowedSedes: ["Floresta"],
      allowedDashboards: ["productividad"],
      specialRoles: null,
      isActive: true,
    });
    const after = buildUserAuditSnapshot({
      username: "ana",
      role: "user",
      portalProfile: "asadero",
      sede: "Floresta",
      allowedSedes: ["Floresta", "Calle 5"],
      allowedDashboards: ["productividad", "margenes"],
      specialRoles: ["asaderos"],
      isActive: true,
    });
    const changed = diffUserAuditSnapshots(before, after);
    assert.deepEqual(
      [...changed].sort(),
      [
        "allowedDashboards",
        "allowedSedes",
        "portalProfile",
        "specialRoles",
      ].sort(),
    );
  });

  it("marca passwordReset como password", () => {
    const before = buildUserAuditSnapshot({
      username: "ana",
      role: "user",
      isActive: true,
    });
    const after = buildUserAuditSnapshot({
      username: "ana",
      role: "user",
      isActive: true,
      passwordReset: true,
    });
    assert.deepEqual(diffUserAuditSnapshots(before, after), ["password"]);
  });

  it("identifica rutas sensibles", () => {
    assert.equal(isAuditSensitivePath("/margenes"), true);
    assert.equal(isAuditSensitivePath("/admin/usuarios"), true);
    assert.equal(isAuditSensitivePath("/secciones"), false);
  });
});
