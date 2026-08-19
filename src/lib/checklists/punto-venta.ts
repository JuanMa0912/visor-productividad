export type PuntoVentaItem = {
  id: string;
  text: string;
  proposed?: boolean;
};

export type PuntoVentaBlock = {
  title: string;
  items: PuntoVentaItem[];
};

export const PUNTO_VENTA_BLOCKS: PuntoVentaBlock[] = [
  {
    title: "Surtido y disponibilidad",
    items: [
      {
        id: "1.1",
        text: "El punto de venta se encuentra surtido antes de las 10:00 a.m., en todas sus categorías y óptimo para la venta.",
      },
      {
        id: "1.2",
        text: "Cuenta con una programación de colaboradores acorde a las estrategias y a las ventas en días clave, para garantizar disponibilidad de producto al cliente.",
      },
      {
        id: "1.3",
        text: "Realiza seguimiento a Restock, cero venta y productos nuevos, garantizando que se encuentren exhibidos, marcados y limpios.",
      },
      {
        id: "1.4",
        text: "Realiza seguimiento a días de inventario para evitar rompimiento de productos tipo A, y cuenta con los soportes de gestión de los productos que lo requieren.",
      },
      {
        id: "1.5",
        text: "Cero agotados en góndola cuando existe inventario disponible en bodega (verificación de espacios y bajantes vacíos).",
        proposed: true,
      },
    ],
  },
  {
    title: "Precios y señalización",
    items: [
      { id: "2.1", text: "Todos los productos del punto de venta están marcados con su precio actual." },
      {
        id: "2.2",
        text: "El precio exhibido coincide con el precio registrado en caja (muestreo aleatorio por categoría).",
        proposed: true,
      },
      {
        id: "2.3",
        text: "Cenefas y señalización legibles, completas y sin precios o promociones vencidas.",
        proposed: true,
      },
    ],
  },
  {
    title: "Estrategias comerciales",
    items: [
      {
        id: "3.1",
        text: "Las estrategias comerciales están exhibidas, aplicadas y señalizadas tanto en líneas como en exhibiciones adicionales, con buena visibilidad para el cliente.",
      },
      {
        id: "3.2",
        text: "Puntas de góndola y exhibiciones adicionales contienen el producto de la estrategia vigente, con inventario suficiente para la jornada.",
        proposed: true,
      },
      {
        id: "3.3",
        text: "El material POP corresponde a campañas vigentes; no hay publicidad de campañas finalizadas.",
        proposed: true,
      },
    ],
  },
  {
    title: "Aseo, orden e infraestructura",
    items: [
      { id: "4.1", text: "Hay aseo en todos los lineales, exhibiciones y muebles de industria." },
      {
        id: "4.2",
        text: "Iluminación completa y equipos de frío limpios y en funcionamiento, sin fugas ni acumulación de hielo.",
        proposed: true,
      },
      {
        id: "4.3",
        text: "Pasillos libres de estibas, canastillas y obstáculos durante el horario de atención al público.",
        proposed: true,
      },
    ],
  },
  {
    title: "Vencidos, PET / FIFO y averías",
    items: [
      {
        id: "5.1",
        text: "No hay productos vencidos en exhibición y se aplica la metodología PET y FIFO en los productos de manufactura.",
      },
      {
        id: "5.2",
        text: "Se evidencia disminución en la tasa de averías y cuenta con los soportes de gestión de los productos que lo requieren.",
      },
      {
        id: "5.3",
        text: "Productos próximos a vencer identificados, con plan de rotación, exhibición prioritaria o liquidación.",
        proposed: true,
      },
      {
        id: "5.4",
        text: "Temperaturas de refrigerados y congelados registradas y dentro del rango establecido.",
        proposed: true,
      },
    ],
  },
  {
    title: "Planimetría y exhibición",
    items: [
      {
        id: "6.1",
        text: "Se cumplen las planimetrías y la exhibición según las negociaciones vigentes en el almacén.",
      },
      {
        id: "6.2",
        text: "Surtido, nivelación y cara del producto correctos en todo el lineal.",
        proposed: true,
      },
    ],
  },
  {
    title: "Colaboradores y personal externo",
    items: [
      {
        id: "7.1",
        text: "Realiza seguimiento y gestión a colaboradores externos y de las marcas que apoyan procesos de surtido, verificando que el punto de venta quede surtido, marcado, aseado y listo para la venta antes de que se retiren del almacén.",
      },
      {
        id: "7.2",
        text: "El personal externo cuenta con carnet, uniforme y presentación acorde a la política, y su ingreso y salida está registrado.",
        proposed: true,
      },
    ],
  },
  {
    title: "Indicadores y gestión",
    items: [
      {
        id: "8.1",
        text: "Todas las categorías crecen en venta, y cuenta con los soportes de gestión de las categorías que lo requieren.",
      },
      {
        id: "8.2",
        text: "Realiza seguimiento a inventarios acorde al cronograma enviado por el área de inventario.",
      },
      {
        id: "8.3",
        text: "El plan de acción de la auditoría anterior está documentado y con cumplimiento verificado.",
        proposed: true,
      },
    ],
  },
];

export const PUNTO_VENTA_ITEM_COUNT = PUNTO_VENTA_BLOCKS.reduce(
  (sum, block) => sum + block.items.length,
  0,
);

export type PuntoVentaScore = 1 | 2 | 3 | 4 | 5 | "na";

export const scorePuntoVenta = (
  answers: Record<string, PuntoVentaScore | null>,
): { pct: number | null; scored: number; applicable: number; total: number } => {
  let sum = 0;
  let applicable = 0;
  let scored = 0;
  let total = 0;
  for (const block of PUNTO_VENTA_BLOCKS) {
    for (const item of block.items) {
      total += 1;
      const value = answers[item.id];
      if (value == null) continue;
      scored += 1;
      if (value === "na") continue;
      applicable += 1;
      sum += value;
    }
  }
  return {
    pct: applicable > 0 ? Math.round((sum / (applicable * 5)) * 1000) / 10 : null,
    scored,
    applicable,
    total,
  };
};
