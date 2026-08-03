import { normalizeKeyCompact } from "@/lib/shared/normalize";
import { getSedeOrderIndexForRawName } from "@/lib/shared/constants";

/**
 * Destinatario del correo consolidado (todas las sedes) en fase piloto.
 * Override: `ROTACION_EMAIL_FORCE_TO`.
 */
export const ROTACION_EMAIL_PILOT_ONLY_TO = "aprendizppt@mercamio.com";

export type RotacionEmailSedeRecipient = {
  /** Nombre canónico del portal (`SEDE_ORDER`). */
  sedeName: string;
  recipients: readonly string[];
  /** Alias del cuaderno / catálogo para emparejar. */
  aliases?: readonly string[];
};

/**
 * Destinatarios del correo **individual** (solo el digest de esa sede).
 *
 * Mapeo del cuaderno operativo (2026-08-03):
 * - 5ta → Calle 5ta (`administradorsta@…`).
 * - Guadalupe → Guaduales (`c.lopez@…`).
 * - Sin correo aún: Centro Sur, Dinastía 1, Dinastía 2.
 */
export const ROTACION_EMAIL_SEDE_RECIPIENTS: readonly RotacionEmailSedeRecipient[] =
  [
    {
      sedeName: "Calle 5ta",
      recipients: ["administradorsta@mercamio.com"],
      aliases: ["5ta", "5TA", "CL 5", "STA"],
    },
    {
      sedeName: "La 39",
      recipients: ["administrador39@mercamio.com"],
      aliases: ["39", "3a", "3A", "Cra 39"],
    },
    {
      sedeName: "Plaza Norte",
      recipients: ["j.cardozo@mercamio.com"],
      aliases: ["Plaza"],
    },
    {
      sedeName: "Ciudad Jardin",
      recipients: ["admjardin@mercamio.com"],
      aliases: ["Ciudad J", "Ciudad Jardín", "Jardin"],
    },
    {
      sedeName: "Palmira",
      recipients: ["subadministrador-pm@mercamio.com"],
    },
    {
      sedeName: "Floresta",
      recipients: ["admon.floresta@mercamio.com"],
    },
    {
      sedeName: "Floralia",
      recipients: ["admon.floralia@mercamio.com"],
    },
    {
      sedeName: "Guaduales",
      recipients: ["c.lopez@mercamio.com"],
      aliases: ["Guadalupe"],
    },
    {
      sedeName: "Bogota",
      recipients: ["administradorcl80@mercamio.com"],
      aliases: ["Bogotá", "La 80", "cl80"],
    },
    {
      sedeName: "Chia",
      recipients: ["administradorchia@mercamio.com"],
      aliases: ["Chía"],
    },
  ] as const;

/** @deprecated Preferir {@link ROTACION_EMAIL_SEDE_RECIPIENTS}. */
export type RotacionEmailPilotSede = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  recipientsEnvKey: string;
};

/** @deprecated Lista corta del piloto Floresta; el envío usa el mapa de destinatarios. */
export const ROTACION_EMAIL_PILOT_SEDES: readonly RotacionEmailPilotSede[] = [
  {
    empresa: "mtodo",
    sedeId: "001",
    sedeName: "Floresta",
    recipientsEnvKey: "ROTACION_EMAIL_FLORESTA_TO",
  },
] as const;

const recipientIndex = (() => {
  const map = new Map<string, RotacionEmailSedeRecipient>();
  for (const entry of ROTACION_EMAIL_SEDE_RECIPIENTS) {
    map.set(normalizeKeyCompact(entry.sedeName), entry);
    for (const alias of entry.aliases ?? []) {
      const key = normalizeKeyCompact(alias);
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

/** Destinatarios del correo individual de una sede (null si aún no hay mapa). */
export const resolveRotacionEmailRecipientsForSede = (
  sedeName: string,
): string[] | null => {
  const entry = recipientIndex.get(normalizeKeyCompact(sedeName));
  if (!entry || entry.recipients.length === 0) return null;
  return [...entry.recipients];
};

export const listRotacionEmailSedesWithRecipients = (): string[] =>
  [...ROTACION_EMAIL_SEDE_RECIPIENTS]
    .sort(
      (a, b) =>
        getSedeOrderIndexForRawName(a.sedeName) -
        getSedeOrderIndexForRawName(b.sedeName),
    )
    .map((entry) => entry.sedeName);
