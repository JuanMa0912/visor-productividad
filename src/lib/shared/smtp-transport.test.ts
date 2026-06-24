import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSmtpTransportOptions,
  resolveSmtpPort,
} from "@/lib/shared/smtp-transport";

test("resolveSmtpPort usa 3465 por defecto (Mercamio)", () => {
  assert.equal(resolveSmtpPort(undefined), 3465);
  assert.equal(resolveSmtpPort("587"), 587);
});

test("buildSmtpTransportOptions aplica SMTPS en 3465", () => {
  const options = buildSmtpTransportOptions("smtp.mercamio.com", 3465, {
    user: "a@b.com",
    pass: "secret",
  });
  assert.equal(options.port, 3465);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, false);
});

test("buildSmtpTransportOptions respeta SMTP_SECURE", () => {
  process.env.SMTP_SECURE = "true";
  try {
    const options = buildSmtpTransportOptions("smtp.mercamio.com", 3465);
    assert.equal(options.secure, true);
  } finally {
    delete process.env.SMTP_SECURE;
  }
});
