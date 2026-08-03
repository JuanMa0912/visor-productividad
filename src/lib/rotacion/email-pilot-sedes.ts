/** Sedes habilitadas en la fase piloto del correo diario de rotación. */
export type RotacionEmailPilotSede = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  /** Variable de entorno con destinatarios separados por coma. */
  recipientsEnvKey: string;
};

/**
 * Destinatario único de pruebas / piloto controlado.
 * El script también fuerza este correo si `ROTACION_EMAIL_FORCE_TO` no está definido.
 */
export const ROTACION_EMAIL_PILOT_ONLY_TO = "aprendizppt@mercamio.com";

export const ROTACION_EMAIL_PILOT_SEDES: readonly RotacionEmailPilotSede[] = [
  {
    empresa: "mtodo",
    sedeId: "001",
    sedeName: "Floresta",
    recipientsEnvKey: "ROTACION_EMAIL_FLORESTA_TO",
  },
] as const;
