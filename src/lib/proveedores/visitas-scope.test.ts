import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProveedorVisitaRow } from "@/lib/proveedores/types";
import {
  metricsFromVisitaRows,
  resolveVisitasBoardView,
  rowMatchesVisitasScope,
  visitaEntradaIsoDateBogota,
} from "@/lib/proveedores/visitas-scope";

const row = (
  partial: Partial<ProveedorVisitaRow> & Pick<ProveedorVisitaRow, "entradaAt">,
): ProveedorVisitaRow => ({
  id: partial.id ?? 1,
  sedeName: partial.sedeName ?? "Floresta",
  proveedorId: partial.proveedorId ?? null,
  proveedorNombre: partial.proveedorNombre ?? "Acme",
  visitanteNombre: partial.visitanteNombre ?? "Ana",
  visitanteCedula: partial.visitanteCedula ?? "123",
  entradaAt: partial.entradaAt,
  salidaAt: partial.salidaAt ?? null,
  duracionMinutos: partial.duracionMinutos ?? null,
});

describe("proveedores visitas-scope", () => {
  it("día de entrada es calendario Bogotá, no UTC", () => {
    // 2026-08-21 02:30 UTC = 2026-08-20 21:30 Bogotá
    assert.equal(
      visitaEntradaIsoDateBogota("2026-08-21T02:30:00.000Z"),
      "2026-08-20",
    );
    // 2026-08-21 05:30 UTC = 2026-08-21 00:30 Bogotá
    assert.equal(
      visitaEntradaIsoDateBogota("2026-08-21T05:30:00.000Z"),
      "2026-08-21",
    );
  });

  it("una sede y un día descartan el resto", () => {
    const scope = {
      dateStart: "2026-08-20",
      dateEnd: "2026-08-20",
      sedeName: "Floresta",
    };
    assert.equal(
      rowMatchesVisitasScope(
        row({ entradaAt: "2026-08-20T15:00:00.000Z" }),
        scope,
      ),
      true,
    );
    assert.equal(
      rowMatchesVisitasScope(
        row({ entradaAt: "2026-08-19T15:00:00.000Z" }),
        scope,
      ),
      false,
    );
    assert.equal(
      rowMatchesVisitasScope(
        row({ sedeName: "Palmira", entradaAt: "2026-08-20T15:00:00.000Z" }),
        scope,
      ),
      false,
    );
  });

  it("si el API trae otras sedes, Floresta no las pinta ni las cuenta", () => {
    const rows = [
      row({
        id: 1,
        sedeName: "Bogota",
        entradaAt: "2026-08-20T15:00:00.000Z",
        visitanteCedula: "1",
      }),
      row({
        id: 2,
        sedeName: "Floresta",
        entradaAt: "2026-08-20T16:00:00.000Z",
        visitanteCedula: "2",
      }),
      row({
        id: 3,
        sedeName: "Chia",
        entradaAt: "2026-08-20T17:00:00.000Z",
        visitanteCedula: "3",
      }),
    ];
    const mixed = metricsFromVisitaRows(rows);
    assert.equal(mixed.totalVisitas, 3);
    const view = resolveVisitasBoardView({
      rows,
      metrics: mixed,
      dateStart: "2026-08-20",
      dateEnd: "2026-08-20",
      sedeName: "Floresta",
    });
    assert.equal(view.rows.length, 1);
    assert.equal(view.rows[0]?.sedeName, "Floresta");
    assert.equal(view.metrics?.totalVisitas, 1);
    assert.deepEqual(
      view.metrics?.bySede.map((s) => s.sedeName),
      ["Floresta"],
    );
  });

  it("si el API trae visitas de otros días, el tablero cuenta solo el rango", () => {
    const rows = [
      row({
        id: 1,
        entradaAt: "2026-08-18T15:00:00.000Z",
        visitanteCedula: "1",
      }),
      row({
        id: 2,
        entradaAt: "2026-08-20T15:00:00.000Z",
        visitanteCedula: "2",
        salidaAt: "2026-08-20T16:00:00.000Z",
        duracionMinutos: 60,
      }),
      row({
        id: 3,
        sedeName: "Palmira",
        entradaAt: "2026-08-20T16:00:00.000Z",
        visitanteCedula: "3",
      }),
    ];
    const view = resolveVisitasBoardView({
      rows,
      metrics: {
        ...metricsFromVisitaRows(rows),
        totalVisitas: 61,
      },
      dateStart: "2026-08-20",
      dateEnd: "2026-08-20",
      sedeName: "Floresta",
    });
    assert.equal(view.rows.length, 1);
    assert.equal(view.metrics?.totalVisitas, 1);
    assert.equal(view.metrics?.proveedoresUnicos, 1);
    assert.equal(view.metrics?.bySede.length, 1);
    assert.equal(view.metrics?.bySede[0]?.sedeName, "Floresta");
  });
});
