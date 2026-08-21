import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRestockSurtidoWhen,
  isLikelyBase64,
  parseRestockSurtidoFotoMime,
  restockSurtidoFotoDataUrl,
  stripDataUrlPrefix,
  validateRestockSurtidoFotoPayload,
} from "./restock-surtido-foto";

test("acepta JPEG base64 corto y rechaza basura", () => {
  const sample = Buffer.from("0123456789abcdef").toString("base64");
  const ok = validateRestockSurtidoFotoPayload(sample, "image/jpeg");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.mime, "image/jpeg");
    assert.equal(ok.base64, sample);
  }
  const bad = validateRestockSurtidoFotoPayload("%%%", "image/jpeg");
  assert.equal(bad.ok, false);
});

test("strips data URL y normaliza image/jpg", () => {
  const inner = Buffer.from("abc").toString("base64");
  assert.equal(stripDataUrlPrefix(`data:image/jpeg;base64,${inner}`), inner);
  assert.equal(parseRestockSurtidoFotoMime("image/jpg"), "image/jpeg");
  assert.equal(isLikelyBase64(inner), true);
  assert.equal(
    restockSurtidoFotoDataUrl(inner, "image/jpeg"),
    `data:image/jpeg;base64,${inner}`,
  );
});

test("formatea cuándo se marcó surtido y rechaza fechas inválidas", () => {
  assert.equal(formatRestockSurtidoWhen(null), null);
  assert.equal(formatRestockSurtidoWhen("no-es-fecha"), null);
  const formatted = formatRestockSurtidoWhen("2026-08-21T14:30:00.000Z");
  assert.equal(typeof formatted, "string");
  assert.ok(formatted && formatted.length > 0);
  assert.match(formatted, /\d/);
});
