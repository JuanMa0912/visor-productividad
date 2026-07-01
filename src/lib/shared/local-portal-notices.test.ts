import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("isLocalPortalMigrationNoticeEnabled", () => {
  it("activa el aviso fuera de GCP y lo bloquea con VISOR_DEPLOYMENT=gcp", async () => {
    const prevFlag = process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    const prevClosed = process.env.LOCAL_PORTAL_CLOSED;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;

    process.env.LOCAL_PORTAL_MIGRATION_NOTICE = "true";
    delete process.env.LOCAL_PORTAL_CLOSED;
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
    if (prevClosed === undefined) {
      delete process.env.LOCAL_PORTAL_CLOSED;
    } else {
      process.env.LOCAL_PORTAL_CLOSED = prevClosed;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
  });
});

describe("isLocalPortalClosed", () => {
  it("cierra el portal local fuera de GCP y lo ignora en GCP", async () => {
    const prevClosed = process.env.LOCAL_PORTAL_CLOSED;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;
    const prevCloud = process.env.LOCAL_PORTAL_CLOUD_URL;

    process.env.LOCAL_PORTAL_CLOSED = "true";
    delete process.env.VISOR_DEPLOYMENT;
    const mod = await import("@/lib/shared/local-portal-notices");
    assert.equal(mod.isLocalPortalClosed(), true);
    assert.equal(
      mod.getLocalPortalCloudUrl(),
      "https://uaid.mercamio.com.co",
    );

    process.env.LOCAL_PORTAL_CLOUD_URL = "https://ejemplo.test/portal/";
    assert.equal(mod.getLocalPortalCloudUrl(), "https://ejemplo.test/portal");

    process.env.VISOR_DEPLOYMENT = "gcp";
    assert.equal(mod.isLocalPortalClosed(), false);

    if (prevClosed === undefined) {
      delete process.env.LOCAL_PORTAL_CLOSED;
    } else {
      process.env.LOCAL_PORTAL_CLOSED = prevClosed;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
    if (prevCloud === undefined) {
      delete process.env.LOCAL_PORTAL_CLOUD_URL;
    } else {
      process.env.LOCAL_PORTAL_CLOUD_URL = prevCloud;
    }
  });

  it("desactiva el aviso de migración cuando el portal local está cerrado", async () => {
    const prevFlag = process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    const prevClosed = process.env.LOCAL_PORTAL_CLOSED;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;

    process.env.LOCAL_PORTAL_MIGRATION_NOTICE = "true";
    process.env.LOCAL_PORTAL_CLOSED = "true";
    delete process.env.VISOR_DEPLOYMENT;

    const { isLocalPortalMigrationNoticeEnabled } = await import(
      "@/lib/shared/local-portal-notices"
    );
    assert.equal(isLocalPortalMigrationNoticeEnabled(), false);

    if (prevFlag === undefined) {
      delete process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    } else {
      process.env.LOCAL_PORTAL_MIGRATION_NOTICE = prevFlag;
    }
    if (prevClosed === undefined) {
      delete process.env.LOCAL_PORTAL_CLOSED;
    } else {
      process.env.LOCAL_PORTAL_CLOSED = prevClosed;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
  });
});
