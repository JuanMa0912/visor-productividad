import type {
  ChecklistBlock,
  ChecklistEmpresaSedes,
} from "@/lib/checklists/types";

/** Definición canónica del Checklist de Bodega (HTML gerencial). */
export const BODEGA_BLOCKS: ChecklistBlock[] = [
  {
    l: "A",
    t: "Orden y presentación",
    a: "var(--s1)",
    q: [
      {
        c: 1,
        x: "La bodega está marcada y rotulada.",
        k: "Todas las ubicaciones, racks y zonas (recibo, averías, devoluciones, químicos) con rótulo visible y legible; las estibas identificadas con producto y fecha de vencimiento hacia el pasillo.",
        w: 2,
        p: 5,
        ac: "Levantar el listado de ubicaciones sin rótulo, imprimir y fijar la rotulación completa (código de ubicación y ficha de producto con fecha de vencimiento) y verificar con recorrido.",
      },
      {
        c: 2,
        x: "La bodega no tiene unidades sueltas.",
        k: "Cero unidades fuera de caja o canastilla; máximo una caja abierta por producto, marcada y ubicada al frente para consumo prioritario.",
        w: 2,
        p: 5,
        ac: "Consolidar las unidades sueltas en su empaque o canastilla, dejar una sola caja abierta por producto al frente y reinstruir al personal de surtido.",
      },
      {
        c: 3,
        x: "La bodega está aseada.",
        k: "Pisos, racks y canastillas limpios, sin residuos ni derrames; cartón y plástico evacuados a reciclaje; pasillos libres y nada de producto en contacto con el piso o las paredes.",
        w: 2,
        p: 5,
        ac: "Ejecutar jornada de aseo profundo, asignar responsable y horario de aseo por turno con planilla de firma, y evacuar cartón y plástico al cierre de cada turno.",
      },
    ],
  },
  {
    l: "B",
    t: "Fechas y calidad del inventario",
    a: "var(--s2)",
    q: [
      {
        c: 4,
        x: "En la bodega no se encuentran productos vencidos.",
        k: "Cero unidades vencidas. Una sola unidad genera No cumple, retiro inmediato y acta.",
        w: 3,
        p: 10,
        ac: "Retirar de inmediato el producto vencido, levantar acta, registrar la baja o devolución en el sistema y hacer barrido total de fechas en la categoría afectada.",
      },
      {
        c: 5,
        x: "La rotación PEPS/FEFO se cumple y el semáforo de próximos a vencer está al día.",
        k: "Muestreo de 10 productos: lo que vence primero está adelante. Semáforo 30/60/90 días actualizado en los últimos 7 días, con acción por producto.",
        w: 3,
        p: 8,
        ac: "Reacomodar el producto aplicando FEFO, actualizar el semáforo 30/60/90 y definir la acción comercial por producto (promoción, traslado o devolución).",
      },
      {
        c: 6,
        x: "El producto no conforme (empaque roto, húmedo, abombado) está separado del inventario vendible.",
        k: "Cero unidades deterioradas mezcladas con el stock disponible.",
        w: 2,
        p: 4,
        ac: "Separar y rotular el producto no conforme en la zona de averías, registrarlo en el sistema y definir su destino final.",
      },
    ],
  },
  {
    l: "C",
    t: "Categorización y niveles de inventario",
    a: "var(--s3)",
    q: [
      {
        c: 7,
        x: "La bodega está recategorizada.",
        k: "Organizada por categoría igual a la sala, alta rotación cerca de la salida a surtido, químicos y aseo separados de alimentos; recategorización hecha dentro de los 30 días siguientes al último cambio de surtido.",
        w: 2,
        p: 5,
        ac: "Reubicar el producto por categoría según el planograma de sala, mover la alta rotación a la zona de salida y separar químicos y aseo de los alimentos.",
      },
      {
        c: 8,
        x: "La bodega no está en excesos de mercancía.",
        k: "Días de inventario dentro de la cobertura definida por categoría; se anexa el listado de productos sobre cobertura.",
        w: 2,
        p: 6,
        ac: "Cuantificar los productos sobre cobertura, congelar pedidos de esos códigos y presentar el listado a compras con la propuesta de evacuación.",
      },
      {
        c: 9,
        x: "Los excesos están reportados y con plan de evacuación en ejecución.",
        k: "Reporte a compras y proveedor en los últimos 7 días, con evidencia; cada producto en exceso con acción (promoción, traslado, negociación o devolución), responsable y fecha.",
        w: 2,
        p: 5,
        ac: "Enviar el reporte de excesos a compras y al proveedor con evidencia, y acordar por producto la acción y la fecha de evacuación.",
      },
    ],
  },
  {
    l: "D",
    t: "Abastecimiento de la sala",
    a: "var(--s4)",
    q: [
      {
        c: 10,
        x: "No hay producto agotado en la sala que tenga existencia en bodega.",
        k: "Recorrido cruzado sobre los productos en cero en sala: cero casos con existencia en bodega.",
        w: 3,
        p: 10,
        ac: "Surtir de inmediato los productos agotados que tienen existencia, ajustar la ruta y el horario de surtido, y verificar el cuadre sistémico de los que aparecen en cero.",
      },
      {
        c: 11,
        x: "El surtido y el reporte de agotados se cumplen en los horarios definidos.",
        k: "Ruta de surtido del turno cumplida y reporte diario de agotados entregado a compras, con responsable y hora.",
        w: 2,
        p: 5,
        ac: "Reasignar la ruta de surtido con responsable y hora, y habilitar el reporte diario de agotados con envío a compras.",
      },
    ],
  },
  {
    l: "E",
    t: "Averías y devoluciones",
    a: "var(--s5)",
    q: [
      {
        c: 12,
        x: "La zona de recuperación de averías está organizada y limpia.",
        k: "Zona demarcada y revisada a diario, averías clasificadas por destino (recuperable, devolución, destrucción) y registradas en el sistema el mismo día.",
        w: 2,
        p: 5,
        ac: "Organizar y limpiar la zona, clasificar las averías por destino, registrarlas en el sistema y establecer revisión diaria con responsable asignado.",
      },
      {
        c: 13,
        x: "No hay devoluciones con más de una semana pendientes de recoger por el proveedor.",
        k: "Cero registros con más de 7 días; devoluciones en zona separada del stock disponible y con documento firmado por proveedor o transportador.",
        w: 3,
        p: 7,
        ac: "Gestionar con el proveedor la recogida de las devoluciones vencidas en plazo, escalar a compras las que no recoja y depurar la zona.",
      },
    ],
  },
  {
    l: "F",
    t: "Control sistémico y cumplimiento",
    a: "var(--s6)",
    q: [
      {
        c: 14,
        x: "Todo producto que ingresa por recibo queda ingresado al sistema el mismo día.",
        k: "Cotejo de remisiones del día contra entradas sistémicas: cero mercancía física sin entrada. El recibo verifica cantidad, calidad, fecha de vencimiento y temperatura cuando aplique.",
        w: 3,
        p: 7,
        ac: "Cotejar remisiones contra entradas del sistema, ingresar lo pendiente el mismo día y reforzar el checklist de recibo con el auxiliar responsable.",
      },
      {
        c: 15,
        x: "Ninguna mercancía sale del almacén sin transferencia o devolución registrada en el sistema.",
        k: "Cero salidas sin documento; los movimientos del día cuadran con la minuta de portería.",
        w: 3,
        p: 7,
        ac: "Identificar las salidas sin documento, generar los movimientos faltantes en el sistema y cerrar el control con portería mediante minuta cruzada.",
      },
      {
        c: 16,
        x: "Seguridad e inocuidad bajo control.",
        k: "Extintores vigentes y despejados, salidas de emergencia libres, racks sin deformación, control de plagas vigente sin evidencias, y temperatura de cuartos fríos dentro de rango con registro diario.",
        w: 3,
        p: 6,
        ac: "Corregir el hallazgo específico (extintor, ruta de evacuación, rack, plagas o temperatura), reportar a mantenimiento o al proveedor del programa y verificar el cierre.",
      },
    ],
  },
];

export const BODEGA_DEFAULT_CFG: ChecklistEmpresaSedes[] = [
  {
    empresa: "Mercamio",
    sedes: ["La 5", "La 39", "Plaza", "C. Jardín", "Centro Sur", "Palmira"],
  },
  {
    empresa: "Comercializadora Floralia",
    sedes: ["Floresta", "Floralia", "Guaduales"],
  },
  { empresa: "Merkmios", sedes: ["Bog. La 80", "Chía"] },
];

export const BODEGA_DEFAULT_PESOS: Record<number, number> = Object.fromEntries(
  BODEGA_BLOCKS.flatMap((b) => b.q.map((it) => [it.c, it.p])),
);
