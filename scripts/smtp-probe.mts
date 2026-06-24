import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

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
          "En la VM suele estar restringido al usuario visor. Prueba:",
          `  sudo -u visor ENV_FILE=${envPath} npm run smtp:probe`,
          "O agrega las variables SMTP a ese archivo como root/visor.",
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
    process.env[key] = parseEnvValue(trimmed.slice(eq + 1));
  }
};

const tryVerify = async (
  label: string,
  host: string,
  port: number,
  user: string,
  pass: string,
) => {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
    },
  });
  try {
    await transporter.verify();
    console.log(`[OK] ${label}`);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.log(`[FAIL] ${label} → ${message.split("\n")[0]}`);
    return false;
  } finally {
    transporter.close();
  }
};

const main = async () => {
  const envFile =
    process.env.ENV_FILE ?? path.join(process.cwd(), ".env.local");
  loadEnvFile(envFile);

  const pass = process.env.SMTP_PASSWORD ?? "";
  const email = process.env.SMTP_USER?.trim() ?? "";
  const localPart = email.includes("@") ? email.split("@")[0] : email;
  const hosts = Array.from(
    new Set(
      [
        process.env.SMTP_HOST?.trim(),
        "smtp.mercamio.com",
        "imap.mercamio.com",
        "correo.mercamio.com",
      ].filter(Boolean) as string[],
    ),
  );
  const ports = [587, 465];
  const users = Array.from(
    new Set([email, localPart, `${localPart}@mercamio.com.co`].filter(Boolean)),
  );

  if (!pass || !email) {
    console.error("Faltan SMTP_USER o SMTP_PASSWORD en .env.local");
    process.exit(1);
  }

  console.log(`Contraseña leída: ${pass.length} caracteres`);
  console.log("Probando combinaciones SMTP (solo verify, sin enviar)...\n");

  let anyOk = false;
  for (const host of hosts) {
    for (const port of ports) {
      for (const user of users) {
        const ok = await tryVerify(
          `${host}:${port} · user=${user}`,
          host,
          port,
          user,
          pass,
        );
        anyOk = anyOk || ok;
      }
    }
  }

  if (!anyOk) {
    console.log(
      "\nNinguna combinación autenticó. Si el webmail funciona, pide a sistemas habilitar SMTP o prueba desde la VM interna.",
    );
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
