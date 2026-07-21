import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPORT_DOWNLOAD_RETENTION_DAYS,
  parseExportDownloadFormat,
  sanitizeExportFilters,
} from "./export-download-log";

describe("export-download-log", () => {
  it("parsea formatos conocidos", () => {
    assert.equal(parseExportDownloadFormat("xlsx"), "xlsx");
    assert.equal(parseExportDownloadFormat("PDF"), "pdf");
    assert.equal(parseExportDownloadFormat("jpg"), "jpeg");
    assert.equal(parseExportDownloadFormat("excel"), "xlsx");
    assert.equal(parseExportDownloadFormat("weird"), "other");
  });

  it("sanitiza filtros", () => {
    assert.equal(sanitizeExportFilters(null), null);
    assert.equal(sanitizeExportFilters(["a"]), null);
    assert.deepEqual(sanitizeExportFilters({ sede: "Calle 5ta" }), {
      sede: "Calle 5ta",
    });
  });

  it("define retencion ~9 meses", () => {
    assert.equal(EXPORT_DOWNLOAD_RETENTION_DAYS, 274);
  });
});
