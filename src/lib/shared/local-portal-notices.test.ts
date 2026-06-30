import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("isLocalPortalMigrationNoticeEnabled", () => {
  it("solo activa el aviso en development con la variable local", async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevFlag = process.env.NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE;

    process.env.NODE_ENV = "development";
    process.env.NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE = "true";
    const { isLocalPortalMigrationNoticeEnabled } = await import(
      "@/lib/shared/local-portal-notices"
    );
    assert.equal(isLocalPortalMigrationNoticeEnabled(), true);

    process.env.NODE_ENV = "production";
    assert.equal(isLocalPortalMigrationNoticeEnabled(), false);

    process.env.NODE_ENV = prevNodeEnv;
    if (prevFlag === undefined) {
      delete process.env.NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE;
    } else {
      process.env.NEXT_PUBLIC_LOCAL_PORTAL_MIGRATION_NOTICE = prevFlag;
    }
  });
});
