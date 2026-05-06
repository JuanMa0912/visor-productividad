import { z } from "zod";
import type { KardexFilters } from "./types";

const optionalTrimmed = z
  .string()
  .trim()
  .min(1)
  .optional()
  .transform((value) => value ?? undefined);

const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .transform((value) => value ?? undefined);

export const KardexFiltersSchema = z
  .object({
    empresa: optionalTrimmed,
    sede: optionalTrimmed,
    bodegaLocal: optionalTrimmed,
    idItem: optionalTrimmed,
    idCategoria: optionalTrimmed,
    idLineaNivel1: optionalTrimmed,
    fechaDesde: optionalDate,
    fechaHasta: optionalDate,
  })
  .superRefine((value, ctx) => {
    if (value.fechaDesde && value.fechaHasta && value.fechaDesde > value.fechaHasta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fechaDesde"],
        message: "fechaDesde no puede ser mayor que fechaHasta",
      });
    }
  });

export const parseKardexFilters = (
  searchParams: URLSearchParams,
): KardexFilters => {
  const raw = {
    empresa: searchParams.get("empresa") ?? undefined,
    sede: searchParams.get("sede") ?? undefined,
    bodegaLocal: searchParams.get("bodegaLocal") ?? undefined,
    idItem: searchParams.get("idItem") ?? undefined,
    idCategoria: searchParams.get("idCategoria") ?? undefined,
    idLineaNivel1: searchParams.get("idLineaNivel1") ?? undefined,
    fechaDesde: searchParams.get("fechaDesde") ?? undefined,
    fechaHasta: searchParams.get("fechaHasta") ?? undefined,
  };
  return KardexFiltersSchema.parse(raw);
};
