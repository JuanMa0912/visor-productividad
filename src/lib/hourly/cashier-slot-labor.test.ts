import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSlotWorkedMinutes,
  getCashierSlotLaborHours,
} from "./cashier-slot-labor";

describe("cashier-slot-labor", () => {
  it("devuelve 0 sin marcas validas", () => {
    assert.equal(computeSlotWorkedMinutes(12 * 60, 60, null), 0);
    assert.equal(
      computeSlotWorkedMinutes(12 * 60, 60, {
        markInMinute: null,
        markOutMinute: 18 * 60,
        break1Minute: null,
        break2Minute: null,
      }),
      0,
    );
    assert.equal(getCashierSlotLaborHours(12 * 60, 60, null), 0);
  });

  it("calcula minutos dentro del turno", () => {
    const shift = {
      markInMinute: 8 * 60,
      markOutMinute: 12 * 60,
      break1Minute: null,
      break2Minute: null,
    };
    assert.equal(computeSlotWorkedMinutes(9 * 60, 60, shift), 60);
    assert.equal(getCashierSlotLaborHours(9 * 60, 60, shift), 1);
  });
});
