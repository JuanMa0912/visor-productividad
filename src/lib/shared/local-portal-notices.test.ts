import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("isLocalPortalMigrationNoticeEnabled", () => {
  it("activa el aviso fuera de GCP y lo bloquea con VISOR_DEPLOYMENT=gcp", async () => {
    const prevFlag = process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;

    process.env.LOCAL_PORTAL_MIGRATION_NOTICE = "true";
    delete process.env.VISOR_DEPLOYMENT;
    const { isLocalPortalMigrationNoticeEnabled } = await import(
      "@/lib/shared/local-portal-notices"
    );
    assert.equal(isLocalPortalMigrationNoticeEnabled(), true);

    process.env.VISOR_DEPLOYMENT = "gcp";
    assert.equal(isLocalPortalMigrationNoticeEnabled(), false);

    if (prevFlag === undefined) {
      delete process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    } else {
      process.env.LOCAL_PORTAL_MIGRATION_NOTICE = prevFlag;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
  });
});
