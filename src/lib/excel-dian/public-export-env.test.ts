import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("isExcelDianPublicAccess", () => {
  it("permite acceso sin login con portal local cerrado", async () => {
    const prevClosed = process.env.LOCAL_PORTAL_CLOSED;
    const prevExport = process.env.EXCEL_DIAN_EXPORT_PUBLIC;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;

    delete process.env.VISOR_DEPLOYMENT;
    delete process.env.EXCEL_DIAN_EXPORT_PUBLIC;
    process.env.LOCAL_PORTAL_CLOSED = "true";

    const mod = await import("@/lib/excel-dian/public-export-env");
    assert.equal(mod.isExcelDianPublicAccess(), true);
    assert.equal(mod.isExcelDianExportPublic(), false);

    delete process.env.LOCAL_PORTAL_CLOSED;
    assert.equal(mod.isExcelDianPublicAccess(), false);

    process.env.EXCEL_DIAN_EXPORT_PUBLIC = "true";
    assert.equal(mod.isExcelDianPublicAccess(), true);
    assert.equal(mod.isExcelDianExportPublic(), true);

    if (prevClosed === undefined) {
      delete process.env.LOCAL_PORTAL_CLOSED;
    } else {
      process.env.LOCAL_PORTAL_CLOSED = prevClosed;
    }
    if (prevExport === undefined) {
      delete process.env.EXCEL_DIAN_EXPORT_PUBLIC;
    } else {
      process.env.EXCEL_DIAN_EXPORT_PUBLIC = prevExport;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
  });

  it("bloquea Excel DIAN publico en GCP aunque la flag este activa", async () => {
    const prevClosed = process.env.LOCAL_PORTAL_CLOSED;
    const prevExport = process.env.EXCEL_DIAN_EXPORT_PUBLIC;
    const prevPublic = process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC;
    const prevDeployment = process.env.VISOR_DEPLOYMENT;

    process.env.VISOR_DEPLOYMENT = "gcp";
    process.env.EXCEL_DIAN_EXPORT_PUBLIC = "true";
    process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC = "true";
    process.env.LOCAL_PORTAL_CLOSED = "true";

    const mod = await import("@/lib/excel-dian/public-export-env");
    assert.equal(mod.isExcelDianExportPublic(), false);
    assert.equal(mod.isExcelDianPublicAccess(), false);

    if (prevClosed === undefined) {
      delete process.env.LOCAL_PORTAL_CLOSED;
    } else {
      process.env.LOCAL_PORTAL_CLOSED = prevClosed;
    }
    if (prevExport === undefined) {
      delete process.env.EXCEL_DIAN_EXPORT_PUBLIC;
    } else {
      process.env.EXCEL_DIAN_EXPORT_PUBLIC = prevExport;
    }
    if (prevPublic === undefined) {
      delete process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC;
    } else {
      process.env.NEXT_PUBLIC_EXCEL_DIAN_EXPORT_PUBLIC = prevPublic;
    }
    if (prevDeployment === undefined) {
      delete process.env.VISOR_DEPLOYMENT;
    } else {
      process.env.VISOR_DEPLOYMENT = prevDeployment;
    }
  });
});
