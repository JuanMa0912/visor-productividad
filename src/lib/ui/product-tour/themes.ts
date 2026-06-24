export type ProductTourTheme =
  | "portal"
  | "venta"
  | "producto"
  | "operacion"
  | "amber";

export const productTourPopoverClass = (theme: ProductTourTheme): string =>
  `product-tour-popover product-tour-popover--${theme}`;

export const productTourHighlightRgb = (theme: ProductTourTheme): string => {
  switch (theme) {
    case "venta":
      return "59, 130, 246";
    case "producto":
    case "amber":
      return "251, 191, 36";
    case "operacion":
      return "244, 63, 94";
    default:
      return "139, 92, 246";
  }
};
