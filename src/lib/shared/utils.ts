import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const formatDateLabel = (
  dateKey: string,
  options: Intl.DateTimeFormatOptions,
  locale = "es-CO",
) =>
  new Intl.DateTimeFormat(locale, options).format(
    new Date(`${dateKey}T12:00:00`),
  )
