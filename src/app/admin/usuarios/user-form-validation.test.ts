import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getWizardSteps,
  hasFieldErrors,
  validateAccountStep,
  validateProfileStep,
  type UserFormState,
} from "./user-form-validation";

const baseState = (): UserFormState => ({
  username: "pipe",
  portalProfile: "gerente",
  role: "user",
  sede: "",
  allowedSedes: ["Palmira"],
  allowedEmpresas: [],
  allowedLines: [],
  allowedDashboards: [],
  allowedSubdashboards: [],
  specialRoles: [],
  password: "Segura123!",
  is_active: true,
});

describe("getWizardSteps", () => {
  it("incluye permisos para personalizado y asadero", () => {
    assert.deepEqual(getWizardSteps("gerente"), [
      "account",
      "profile",
      "summary",
    ]);
    assert.deepEqual(getWizardSteps("personalizado"), [
      "account",
      "profile",
      "permissions",
      "summary",
    ]);
    assert.deepEqual(getWizardSteps("asadero"), [
      "account",
      "profile",
      "permissions",
      "summary",
    ]);
  });
});

describe("validateAccountStep", () => {
  it("exige usuario y contraseña al crear", () => {
    const errors = validateAccountStep(
      {
        ...baseState(),
        username: "",
        password: "",
      },
      false,
    );
    assert.equal(errors.username, "El nombre de usuario es obligatorio.");
    assert.equal(
      errors.password,
      "La contraseña es obligatoria al crear un usuario.",
    );
  });

  it("permite contraseña vacía al editar", () => {
    const errors = validateAccountStep(
      {
        ...baseState(),
        id: "1",
        password: "",
      },
      true,
    );
    assert.equal(errors.password, undefined);
  });
});

describe("validateProfileStep", () => {
  it("exige sedes para perfiles no admin", () => {
    const errors = validateProfileStep({
      ...baseState(),
      allowedSedes: [],
    });
    assert.equal(
      errors.allowedSedes,
      "Selecciona al menos una sede para este perfil.",
    );
  });

  it("rechaza Todas en gerente", () => {
    const errors = validateProfileStep({
      ...baseState(),
      portalProfile: "gerente",
      allowedSedes: ["Todas", "Palmira"],
    });
    assert.match(errors.allowedSedes ?? "", /Todas/);
  });
});

describe("hasFieldErrors", () => {
  it("detecta errores presentes", () => {
    assert.equal(hasFieldErrors({}), false);
    assert.equal(hasFieldErrors({ username: "x" }), true);
  });
});
