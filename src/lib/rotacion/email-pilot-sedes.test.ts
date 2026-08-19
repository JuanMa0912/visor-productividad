import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveRotacionEmailRecipientsForSede,
  listRotacionEmailSedesWithRecipients,
  resolveRotacionEmailConsolidatedRecipients,
  ROTACION_EMAIL_CONSOLIDATED_TO,
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

  it("el consolidado diario incluye a alexander y aprendiz", () => {
    const recipients = resolveRotacionEmailConsolidatedRecipients();
    assert.deepEqual(recipients, [...ROTACION_EMAIL_CONSOLIDATED_TO]);
    assert.ok(recipients.includes("alexander@mercamio.com"));
    assert.ok(recipients.includes("aprendizppt@mercamio.com"));
  });

  it("ROTACION_EMAIL_FORCE_TO reemplaza la lista consolidada", () => {
    assert.deepEqual(
      resolveRotacionEmailConsolidatedRecipients(
        " gerencia@example.com , otro@example.com ",
      ),
      ["gerencia@example.com", "otro@example.com"],
    );
  });
});
