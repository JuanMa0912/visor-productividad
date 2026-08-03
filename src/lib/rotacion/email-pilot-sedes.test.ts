import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveRotacionEmailRecipientsForSede,
  listRotacionEmailSedesWithRecipients,
} from "@/lib/rotacion/email-pilot-sedes";

describe("email-pilot-sedes recipients", () => {
  it("resuelve aliases del cuaderno a la sede canónica", () => {
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("5ta"), [
      "administradorsta@mercamio.com",
    ]);
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("39"), [
      "administrador39@mercamio.com",
    ]);
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("Guadalupe"), [
      "c.lopez@mercamio.com",
    ]);
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("Guaduales"), [
      "c.lopez@mercamio.com",
    ]);
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("Plaza Norte"), [
      "j.cardozo@mercamio.com",
    ]);
    assert.deepEqual(resolveRotacionEmailRecipientsForSede("Bogota"), [
      "administradorcl80@mercamio.com",
    ]);
    assert.equal(resolveRotacionEmailRecipientsForSede("Centro Sur"), null);
  });

  it("lista sedes con destinatario en orden portal", () => {
    const names = listRotacionEmailSedesWithRecipients();
    assert.ok(names.includes("Floresta"));
    assert.ok(names.indexOf("Calle 5ta") < names.indexOf("Floresta"));
  });
});
