import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessChecklistPanel,
  canFillAnyChecklist,
  canFillChecklistAsEncargado,
  canFillChecklistAsRevisor,
  canUnlockChecklistRuns,
} from "./access";

describe("roles de checklist", () => {
  it("asigna encargado, revisor y panel a personas concretas", () => {
    assert.equal(canFillChecklistAsEncargado(["checklist_encargado"]), true);
    assert.equal(canFillChecklistAsRevisor(["checklist_encargado"]), false);
    assert.equal(canFillChecklistAsRevisor(["checklist_revisor"]), true);
    assert.equal(canFillAnyChecklist(["checklist_panel"]), false);
    assert.equal(canAccessChecklistPanel(["checklist_panel"]), true);
    assert.equal(canUnlockChecklistRuns(["checklist_encargado"]), false);
  });

  it("el admin puede todo", () => {
    assert.equal(canFillAnyChecklist([], true), true);
    assert.equal(canUnlockChecklistRuns([], true), true);
  });
});
