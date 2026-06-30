import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("isLocalPortalMigrationNoticeEnabled", () => {
  it("activa el aviso en build local y lo bloquea en servidor GCP", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFlag = process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    const prevTrustProxy = process.env.TRUST_PROXY;

    process.env.NODE_ENV = "production";
    process.env.LOCAL_PORTAL_MIGRATION_NOTICE = "true";
    process.env.TRUST_PROXY = "false";
    const { isLocalPortalMigrationNoticeEnabled } = await import(
      "@/lib/shared/local-portal-notices"
    );
    assert.equal(isLocalPortalMigrationNoticeEnabled(), true);

    process.env.TRUST_PROXY = "true";
    assert.equal(isLocalPortalMigrationNoticeEnabled(), false);

    process.env.NODE_ENV = prevNodeEnv;
    if (prevFlag === undefined) {
      delete process.env.LOCAL_PORTAL_MIGRATION_NOTICE;
    } else {
      process.env.LOCAL_PORTAL_MIGRATION_NOTICE = prevFlag;
    }
    if (prevTrustProxy === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = prevTrustProxy;
    }
  });
});
