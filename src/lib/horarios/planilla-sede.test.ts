import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPlanillaPlantaSede,
  mapRawSedeToCanonical,
  mapRawSedeToPlantaSeccion,
  migratePlanillaSedeSeccion,
  toCanonicalPlanillaSede,
} from "@/lib/horarios/planilla-sede";

describe("planilla planta hierarchy", () => {
  it("mapea panificadora/desposte/desprese a sede Planta", () => {
    assert.equal(mapRawSedeToCanonical("Panificadora"), "Planta");
    assert.equal(mapRawSedeToCanonical("planta desposte mixto"), "Planta");
    assert.equal(mapRawSedeToCanonical("Planta Desprese Pollo"), "Planta");
    assert.equal(toCanonicalPlanillaSede("Panificadora"), "Planta");
    assert.equal(isPlanillaPlantaSede("panificadora"), true);
  });

  it("infiere seccion desde el texto crudo de asistencia", () => {
    assert.equal(mapRawSedeToPlantaSeccion("panificadora"), "Panificadora");
    assert.equal(
      mapRawSedeToPlantaSeccion("planta desposte mixto"),
      "Planta Desposte Mixto",
    );
    assert.equal(
      mapRawSedeToPlantaSeccion("planta desprese pollo"),
      "Planta Desprese Pollo",
    );
  });

  it("migra planillas legacy sede=area / seccion=Planta", () => {
    assert.deepEqual(
      migratePlanillaSedeSeccion("Panificadora", "Planta"),
      { sede: "Planta", seccion: "Panificadora" },
    );
    assert.deepEqual(
      migratePlanillaSedeSeccion("Planta Desposte Mixto", "Planta"),
      { sede: "Planta", seccion: "Planta Desposte Mixto" },
    );
    assert.deepEqual(
      migratePlanillaSedeSeccion("Planta", "Planta Desprese Pollo"),
      { sede: "Planta", seccion: "Planta Desprese Pollo" },
    );
    assert.deepEqual(migratePlanillaSedeSeccion("Calle 5ta", "Cajas"), {
      sede: "Calle 5ta",
      seccion: "Cajas",
    });
  });
});
