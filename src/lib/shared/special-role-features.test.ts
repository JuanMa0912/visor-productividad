import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALLOWED_SPECIAL_ROLE_SET,
  canDeleteRotacionRestockSurtidoFoto,
} from "./special-role-features";

test("admin siempre puede eliminar foto de surtido; el resto necesita el subrol", () => {
  assert.equal(canDeleteRotacionRestockSurtidoFoto(null, true), true);
  assert.equal(canDeleteRotacionRestockSurtidoFoto([], true), true);
  assert.equal(canDeleteRotacionRestockSurtidoFoto(null, false), false);
  assert.equal(canDeleteRotacionRestockSurtidoFoto([], false), false);
  assert.equal(
    canDeleteRotacionRestockSurtidoFoto(["historial_sinventario"], false),
    false,
  );
  assert.equal(
    canDeleteRotacionRestockSurtidoFoto(["eliminar_foto_surtido"], false),
    true,
  );
});

test("el catalogo de special_roles acepta eliminar_foto_surtido", () => {
  assert.equal(ALLOWED_SPECIAL_ROLE_SET.has("eliminar_foto_surtido"), true);
  assert.equal(ALLOWED_SPECIAL_ROLE_SET.has("historial_sinventario"), true);
});
