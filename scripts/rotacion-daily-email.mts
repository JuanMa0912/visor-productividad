import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { buildRotacionCriticalDigest } from "@/lib/rotacion/critical-digest";
import {
  buildRotacionCriticalDigestHtml,
  buildRotacionCriticalDigestSubject,
  buildRotacionCriticalDigestText,
} from "@/lib/rotacion/critical-digest-email";
import { ROTACION_EMAIL_PILOT_SEDES } from "@/lib/rotacion/email-pilot-sedes";
import { loadRotacionCriticalDigestSource } from "@/lib/rotacion/server/load-critical-digest-source";

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
) => {
  const authMethod = process.env.SMTP_AUTH_METHOD?.trim();
  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    requireTLS: smtpPort === 587,
    auth: { user: smtpUser, pass: smtpPassword },
    ...(authMethod ? { authMethod } : {}),
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      servername: process.env.SMTP_TLS_SERVERNAME?.trim() || undefined,
    },
  });
};

const main = async () => {
  const envFile =
    process.env.ENV_FILE ?? path.join(process.cwd(), ".env.local");
  loadEnvFile(envFile);

  const dryRun = isTruthy(process.env.ROTACION_EMAIL_DRY_RUN);
  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpPort = Number(process.env.SMTP_PORT ?? 587);
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
          "· Si el webmail entra pero SMTP falla: suele ser IP externa bloqueada o contraseña distinta en .env.local",
          "· Prueba: npm run smtp:probe",
          "· O ejecuta desde la VM interna (192.168.35.232)",
        ].join("\n"),
      );
      process.exit(1);
    }
    return;
  }

  let hadError = false;

  for (const sede of ROTACION_EMAIL_PILOT_SEDES) {
    const recipients = parseRecipients(process.env[sede.recipientsEnvKey]);
    if (recipients.length === 0) {
      console.warn(
        `[${sede.sedeName}] Sin destinatarios en ${sede.recipientsEnvKey}; se omite.`,
      );
      continue;
    }

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
      const subject = buildRotacionCriticalDigestSubject(digest);
      const html = buildRotacionCriticalDigestHtml(digest);
      const text = buildRotacionCriticalDigestText(digest);

      if (dryRun || !transporter) {
        console.log(`[DRY RUN] ${sede.sedeName} → ${recipients.join(", ")}`);
        console.log(`Asunto: ${subject}`);
        console.log(text);
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
        `[OK] Correo enviado · ${sede.sedeName} → ${recipients.join(", ")}`,
      );
    } catch (error) {
      hadError = true;
      console.error(`[${sede.sedeName}] Error:`, error);
    }
  }

  if (hadError) process.exit(1);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
