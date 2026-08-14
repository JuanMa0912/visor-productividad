import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasProductivityVolumeShape,
  lineHasActivity,
  resolveProductivityLineFromRoll,
  splitAsaderoQty,
  volumeKindForLine,
} from "@/lib/productivity/line-volume";

describe("productivity line-volume", () => {
  it("mapea N1 de cat. 4 a fruver/carnes/pollo/industria", () => {
    assert.equal(resolveProductivityLineFromRoll("4", "01"), "fruver");
    assert.equal(resolveProductivityLineFromRoll("4", "1"), "fruver");
    assert.equal(resolveProductivityLineFromRoll("4", "02"), "carnes");
    assert.equal(resolveProductivityLineFromRoll("4", "03"), "pollo y pescado");
    assert.equal(resolveProductivityLineFromRoll("4", "04"), "pollo y pescado");
    assert.equal(resolveProductivityLineFromRoll("4", "05"), "industria");
    assert.equal(resolveProductivityLineFromRoll("3", "01"), "asadero");
    assert.equal(resolveProductivityLineFromRoll("V", "01"), null);
  });

  it("asigna unidad de tarjeta por línea", () => {
    assert.equal(volumeKindForLine("cajas"), "tx");
    assert.equal(volumeKindForLine("industria"), "und");
    assert.equal(volumeKindForLine("fruver"), "kg");
    assert.equal(volumeKindForLine("asadero"), "asadero");
  });

  it("conserva días con volumen aunque ventas y horas sean 0", () => {
    assert.equal(
      lineHasActivity({
        id: "fruver",
        name: "Fruver",
        sales: 0,
        hours: 0,
        hourlyRate: 0,
        volume: 12,
      }),
      true,
    );
    assert.equal(
      hasProductivityVolumeShape([
        {
          lines: [
            { id: "cajas", name: "Cajas", sales: 1, hours: 0, hourlyRate: 0 },
          ],
        },
      ]),
      false,
    );
    assert.equal(
      hasProductivityVolumeShape([
        {
          lines: [
            {
              id: "cajas",
              name: "Cajas",
              sales: 1,
              hours: 0,
              hourlyRate: 0,
              transactions: 0,
            },
          ],
        },
      ]),
      true,
    );
  });

  it("separa UND.Pollo vs unidades no-pollo como Informe Variación", () => {
    const pollo = splitAsaderoQty({
      idTipo: "3",
      idLinea1: "01",
      idLinea2: "01",
      nombreLinea1: "POLLO ASADO",
      nombreLinea2: "POLLO",
      idItem: "063024",
      itemDescripcion: "POLLO ASADO ENTERO",
      cantidad: 10,
    });
    assert.equal(pollo.pollosUnd, 10);
    assert.equal(pollo.otherUnd, 0);

    const medio = splitAsaderoQty({
      idTipo: "3",
      idLinea1: "01",
      idLinea2: "01",
      nombreLinea1: "POLLO ASADO",
      nombreLinea2: "POLLO",
      idItem: "063025",
      itemDescripcion: "POLLO ASADO MEDIO",
      cantidad: 8,
    });
    assert.equal(medio.pollosUnd, 4);
    assert.equal(medio.otherUnd, 0);

    const other = splitAsaderoQty({
      idTipo: "3",
      idLinea1: "01",
      idLinea2: "02",
      nombreLinea1: "POLLO ASADO",
      nombreLinea2: "ENSALADAS",
      idItem: "063099",
      itemDescripcion: "ENSALADA",
      cantidad: 4,
    });
    assert.equal(other.pollosUnd, 0);
    assert.equal(other.otherUnd, 4);

    const sides = splitAsaderoQty({
      idTipo: "3",
      idLinea1: "01",
      idLinea2: "01",
      nombreLinea1: "POLLO ASADO",
      nombreLinea2: "POLLO",
      idItem: "063027",
      itemDescripcion: "PORCION PAPAS AMARILLAS",
      cantidad: 6,
    });
    assert.equal(sides.pollosUnd, 0);
    assert.equal(sides.otherUnd, 6);
  });
});
