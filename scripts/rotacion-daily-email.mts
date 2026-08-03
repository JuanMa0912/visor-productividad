import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { buildSmtpTransportOptions, resolveSmtpPort } from "@/lib/shared/smtp-transport";
import {
  buildRotacionCriticalDigest,
  type RotacionCriticalDigest,
} from "@/lib/rotacion/critical-digest";
import {
  buildRotacionCriticalDigestHtml,
  buildRotacionCriticalDigestSubject,
  buildRotacionCriticalDigestText,
} from "@/lib/rotacion/critical-digest-email";
import {
  buildRotacionCriticalDigestConsolidatedHtml,
  buildRotacionCriticalDigestConsolidatedSubject,
  buildRotacionCriticalDigestConsolidatedText,
} from "@/lib/rotacion/critical-digest-consolidated-email";
import {
  ROTACION_EMAIL_PILOT_ONLY_TO,
  resolveRotacionEmailRecipientsForSede,
} from "@/lib/rotacion/email-pilot-sedes";
import { loadRotacionCriticalDigestSource } from "@/lib/rotacion/server/load-critical-digest-source";
import {
  resolveRotacionEmailSedes,
  type RotacionEmailSede,
} from "@/lib/rotacion/server/resolve-email-sedes";

const parseEnvValue = (raw: string) => {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value;
};

const loadEnvFile = (envPath: string) => {
  if (!fs.existsSync(envPath)) {
    console.error(`No existe el archivo de entorno: ${envPath}`);
    process.exit(1);
  }
  let envContent: string;
  try {
    envContent = fs.readFileSync(envPath, "utf-8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "";
    if (code === "EACCES") {
      console.error(
        [
          `Sin permiso para leer ${envPath}`,
          "En la VM ejecuta como usuario visor:",
          `  sudo -u visor ENV_FILE=${envPath} npm run rotacion:email`,
        ].join("\n"),
      );
      process.exit(1);
    }
    throw error;
  }
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = parseEnvValue(trimmed.slice(eq + 1));
    if (key) process.env[key] = value;
  }
};

const parseRecipients = (raw: string | undefined) =>
  (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const isTruthy = (value: string | undefined) =>
  value === "1" || value === "true" || value === "yes";

const buildSmtpTransporter = (
  smtpHost: string,
  smtpPort: number,
  smtpUser: string,
  smtpPassword: string,
) =>
  nodemailer.createTransport(
    buildSmtpTransportOptions(smtpHost, smtpPort, {
      user: smtpUser,
      pass: smtpPassword,
    }),
  );

const sedeKey = (sede: Pick<RotacionEmailSede, "empresa" | "sedeId">) =>
  `${sede.empresa}::${sede.sedeId}`;

const main = async () => {
  const envFile =
    process.env.ENV_FILE ?? path.join(process.cwd(), ".env.local");
  loadEnvFile(envFile);

  const dryRun = isTruthy(process.env.ROTACION_EMAIL_DRY_RUN);
  // Individuales ON por defecto (mapa por sede). Off: ROTACION_EMAIL_SKIP_INDIVIDUAL=true
  const skipIndividual = isTruthy(process.env.ROTACION_EMAIL_SKIP_INDIVIDUAL);
  const skipConsolidated = isTruthy(
    process.env.ROTACION_EMAIL_SKIP_CONSOLIDATED,
  );
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = resolveSmtpPort(process.env.SMTP_PORT);
  const smtpUser =
    process.env.SMTP_AUTH_USER?.trim() || process.env.SMTP_USER?.trim();
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom =
    process.env.SMTP_FROM?.trim() ??
    process.env.SMTP_USER?.trim() ??
    "visor-productividad@localhost";
  if (!dryRun && (!smtpHost || !smtpUser || !smtpPassword)) {
    console.error(
      "Configura SMTP_HOST, SMTP_USER y SMTP_PASSWORD (o ROTACION_EMAIL_DRY_RUN=true).",
    );
    process.exit(1);
  }

  const transporter =
    dryRun || !smtpHost
      ? null
      : buildSmtpTransporter(
          smtpHost,
          smtpPort,
          smtpUser!,
          smtpPassword!,
        );

  if (isTruthy(process.env.SMTP_VERIFY_ONLY)) {
    if (!transporter) {
      console.error("SMTP_VERIFY_ONLY requiere host, usuario y contraseña.");
      process.exit(1);
    }
    try {
      await transporter.verify();
      console.log(
        `[OK] SMTP verificado · ${smtpHost}:${smtpPort} · ${smtpUser}`,
      );
    } catch (error) {
      console.error("[SMTP] Verificación fallida:", error);
      process.exit(1);
    }
    return;
  }

  if (isTruthy(process.env.ROTACION_EMAIL_SMTP_TEST_ONLY)) {
    if (!transporter) {
      console.error("ROTACION_EMAIL_SMTP_TEST_ONLY requiere SMTP configurado.");
      process.exit(1);
    }
    const to =
      parseRecipients(process.env.ROTACION_EMAIL_FLORESTA_TO)[0] ??
      "aprendizppt@mercamio.com";
    try {
      await transporter.sendMail({
        from: smtpFrom,
        to,
        subject: "Prueba SMTP · Rotación Visor",
        text: "Correo de prueba del visor de productividad (rotación).",
        html: "<p>Correo de <strong>prueba</strong> del visor de productividad (rotación).</p>",
      });
      console.log(`[OK] Correo de prueba enviado → ${to}`);
    } catch (error) {
      console.error("[SMTP] Envío de prueba fallido:", error);
      console.error(
        [
          "Checklist:",
          `· Host ${smtpHost}:${smtpPort} · usuario auth: ${smtpUser}`,
          `· Longitud contraseña leída: ${smtpPassword?.length ?? 0} caracteres`,
          "· Si el webmail entra pero SMTP falla con 535: la cuenta puede no tener SMTP habilitado (pedir a sistemas)",
          "· Prueba: npm run smtp:probe",
          "· O ejecuta desde la VM interna (192.168.35.232)",
        ].join("\n"),
      );
      process.exit(1);
    }
    return;
  }

  // Consolidado: siempre aprendiz (o FORCE_TO). No usa el mapa por sede.
  const consolidatedTo =
    process.env.ROTACION_EMAIL_FORCE_TO?.trim() || ROTACION_EMAIL_PILOT_ONLY_TO;
  // Prueba: redirige TODOS los individuales a una sola bandeja.
  const forceIndividualTo =
    process.env.ROTACION_EMAIL_FORCE_INDIVIDUAL_TO?.trim() || "";

  let hadError = false;
  const digestsByKey = new Map<string, RotacionCriticalDigest>();

  let catalogSedes: RotacionEmailSede[] = [];
  try {
    catalogSedes = await resolveRotacionEmailSedes();
  } catch (error) {
    console.error("[catálogo] No se pudieron resolver sedes:", error);
    hadError = true;
  }

  const sedesToLoad = catalogSedes;

  if (sedesToLoad.length === 0) {
    console.error("No hay sedes para cargar digests de rotación.");
    process.exit(1);
  }

  console.log(`Cargando digests · ${sedesToLoad.length} sede(s) (catálogo)`);

  for (const sede of sedesToLoad) {
    try {
      const source = await loadRotacionCriticalDigestSource({
        empresa: sede.empresa,
        sedeId: sede.sedeId,
        sedeName: sede.sedeName,
      });
      if (!source) {
        console.error(
          `[${sede.sedeName}] No hay datos de rotación disponibles (rango vacío).`,
        );
        hadError = true;
        continue;
      }

      const digest = buildRotacionCriticalDigest(source);
      digestsByKey.set(sedeKey(sede), digest);
      console.log(
        `[OK] Digest · ${digest.sedeName} · ${digest.total.itemCount} productos`,
      );
    } catch (error) {
      hadError = true;
      console.error(`[${sede.sedeName}] Error al cargar:`, error);
    }
  }

  if (!skipIndividual) {
    const digests = [...digestsByKey.values()];
    let sentCount = 0;
    let skippedNoRecipient = 0;

    for (const digest of digests) {
      const mapped = resolveRotacionEmailRecipientsForSede(digest.sedeName);
      if (!mapped || mapped.length === 0) {
        skippedNoRecipient += 1;
        console.log(
          `[skip] Individual · ${digest.sedeName} (sin destinatario en mapa)`,
        );
        continue;
      }

      const recipients = forceIndividualTo ? [forceIndividualTo] : mapped;

      try {
        const subject = buildRotacionCriticalDigestSubject(digest);
        const html = buildRotacionCriticalDigestHtml(digest);
        const text = buildRotacionCriticalDigestText(digest);

        if (dryRun || !transporter) {
          console.log(
            `[DRY RUN] Individual · ${digest.sedeName} → ${recipients.join(", ")}`,
          );
          console.log(`Asunto: ${subject}`);
          console.log(text);
          sentCount += 1;
          continue;
        }

        await transporter.sendMail({
          from: smtpFrom,
          to: recipients.join(", "),
          subject,
          text,
          html,
        });
        console.log(
          `[OK] Correo individual · ${digest.sedeName} → ${recipients.join(", ")}`,
        );
        sentCount += 1;
      } catch (error) {
        hadError = true;
        console.error(`[${digest.sedeName}] Error al enviar individual:`, error);
      }
    }

    console.log(
      `Individuales: ${sentCount} enviados · ${skippedNoRecipient} sin destinatario`,
    );
  } else {
    console.log(
      "[skip] Correos individuales (ROTACION_EMAIL_SKIP_INDIVIDUAL).",
    );
  }

  if (!skipConsolidated) {
    const consolidatedDigests =
      catalogSedes.length > 0
        ? catalogSedes
            .map((sede) => digestsByKey.get(sedeKey(sede)))
            .filter((d): d is RotacionCriticalDigest => Boolean(d))
        : [...digestsByKey.values()];

    if (consolidatedDigests.length === 0) {
      console.error("[consolidado] No hay digests para armar el correo cadena.");
      hadError = true;
    } else {
      try {
        const subject =
          buildRotacionCriticalDigestConsolidatedSubject(consolidatedDigests);
        const html =
          buildRotacionCriticalDigestConsolidatedHtml(consolidatedDigests);
        const text =
          buildRotacionCriticalDigestConsolidatedText(consolidatedDigests);
        const recipients = [consolidatedTo];

        if (dryRun || !transporter) {
          console.log(
            `[DRY RUN] Consolidado · ${consolidatedDigests.length} sedes → ${recipients.join(", ")}`,
          );
          console.log(`Asunto: ${subject}`);
          console.log(text);
        } else {
          await transporter.sendMail({
            from: smtpFrom,
            to: recipients.join(", "),
            subject,
            text,
            html,
          });
          console.log(
            `[OK] Correo consolidado · ${consolidatedDigests.length} sedes → ${recipients.join(", ")}`,
          );
        }
      } catch (error) {
        hadError = true;
        console.error("[consolidado] Error al enviar:", error);
      }
    }
  } else {
    console.log(
      "[skip] Correo consolidado (ROTACION_EMAIL_SKIP_CONSOLIDATED).",
    );
  }

  if (hadError) process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
