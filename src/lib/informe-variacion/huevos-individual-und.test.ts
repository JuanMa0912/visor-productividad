import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  convertHuevosQtyToUndIndividuales,
  resolveHuevosPackSize,
  shouldConvertHuevosToUndIndividuales,
} from "@/lib/informe-variacion/huevos-individual-und";

const LINE = "12 HUEVOS";
const SUB = "02 HUEVOS ROSADOS";

describe("resolveHuevosPackSize", () => {
  it("lee multiplicador *Nund del nombre del item", () => {
    assert.equal(resolveHuevosPackSize("028992 HUEVO MERCAMIO ROSADO AA*30und"), 30);
    assert.equal(resolveHuevosPackSize("024823 HUEVO MERCAMIO ROSADO A*15und"), 15);
    assert.equal(resolveHuevosPackSize("066015 HUEVO MERCAMIO ROSADO AA*12und CARTON"), 12);
    assert.equal(resolveHuevosPackSize("075720 HUEVO KIKES AA*28und PET PGUE 28 LLVE 30"), 28);
  });

  it("granel o *und sin cifra cuenta como 1", () => {
    assert.equal(resolveHuevosPackSize("013070 HUEVO MERCAMIO ROSADO A*und GRANEL"), 1);
  });
});

describe("convertHuevosQtyToUndIndividuales", () => {
  it("multiplica cantidad vendida por unidades del empaque", () => {
    assert.equal(
      convertHuevosQtyToUndIndividuales(2323, "028992 HUEVO MERCAMIO ROSADO AA*30und"),
      69_690,
    );
    assert.equal(
      convertHuevosQtyToUndIndividuales(177, "024823 HUEVO MERCAMIO ROSADO A*15und"),
      2_655,
    );
    assert.equal(
      convertHuevosQtyToUndIndividuales(402, "013070 HUEVO MERCAMIO ROSADO A*und GRANEL"),
      402,
    );
  });
});

describe("shouldConvertHuevosToUndIndividuales", () => {
  it("aplica solo en linea y sublinea de huevos", () => {
    assert.equal(shouldConvertHuevosToUndIndividuales(LINE, SUB), true);
    assert.equal(shouldConvertHuevosToUndIndividuales(LINE, "01 POLLO"), false);
    assert.equal(shouldConvertHuevosToUndIndividuales("01 POLLO ASADO", SUB), false);
  });
});
