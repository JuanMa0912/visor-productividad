/** Sedes habilitadas en la fase piloto del correo diario de rotación. */
export type RotacionEmailPilotSede = {
  empresa: string;
  sedeId: string;
  sedeName: string;
  /** Variable de entorno con destinatarios separados por coma. */
  recipientsEnvKey: string;
};

export const ROTACION_EMAIL_PILOT_SEDES: readonly RotacionEmailPilotSede[] = [
  {
    empresa: "mtodo",
    sedeId: "001",
    sedeName: "Floresta",
    recipientsEnvKey: "ROTACION_EMAIL_FLORESTA_TO",
  },
] as const;
