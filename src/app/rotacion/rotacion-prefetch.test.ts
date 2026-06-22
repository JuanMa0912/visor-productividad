import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveRotacionPrefetchSedeValues,
  sedeOptionMatchesUserHint,
} from "./rotacion-prefetch";

const FLORESTA = {
  value: "mercamio::003",
  empresa: "mercamio",
  sedeId: "003",
  sedeName: "Floresta",
};

const FLORALIA = {
  value: "mercamio::004",
  empresa: "mercamio",
  sedeId: "004",
  sedeName: "Floralia",
};

test("sedeOptionMatchesUserHint reconoce sede de perfil", () => {
  assert.equal(sedeOptionMatchesUserHint("Floresta", FLORESTA), true);
  assert.equal(sedeOptionMatchesUserHint("Bogota", FLORESTA), false);
  assert.equal(sedeOptionMatchesUserHint("Floresta", FLORALIA), false);
});

test("resolveRotacionPrefetchSedeValues prioriza seleccion actual", () => {
  const values = resolveRotacionPrefetchSedeValues({
    authUser: {
      id: "u1",
      role: "admin",
      sede: "Floresta",
      allowedSedes: null,
    },
    allSedeOptions: [FLORESTA, FLORALIA],
    selectedSedeValues: [FLORALIA.value],
    lastSedeStorageKey: "rotacion.lastSedeSelection",
    isUserScopedToSpecificSedes: false,
  });
  assert.deepEqual(values, [FLORALIA.value]);
});

test("resolveRotacionPrefetchSedeValues usa sede de perfil si no hay seleccion", () => {
  const values = resolveRotacionPrefetchSedeValues({
    authUser: {
      id: "u1",
      role: "user",
      sede: "Floresta",
      allowedSedes: null,
    },
    allSedeOptions: [FLORESTA, FLORALIA],
    selectedSedeValues: [],
    lastSedeStorageKey: "rotacion.lastSedeSelection",
    isUserScopedToSpecificSedes: false,
  });
  assert.deepEqual(values, [FLORESTA.value]);
});

test("resolveRotacionPrefetchSedeValues autoselecciona sede unica para usuario no admin", () => {
  const values = resolveRotacionPrefetchSedeValues({
    authUser: {
      id: "u1",
      role: "user",
      sede: null,
      allowedSedes: ["Todas"],
    },
    allSedeOptions: [FLORESTA],
    selectedSedeValues: [],
    lastSedeStorageKey: "rotacion.lastSedeSelection",
    isUserScopedToSpecificSedes: false,
  });
  assert.deepEqual(values, [FLORESTA.value]);
});
