import type SMTPTransport from "nodemailer/lib/smtp-transport";

/** Puertos SMTPS (TLS desde el primer byte). Mercamio: 3465. */
export const SMTP_IMPLICIT_TLS_PORTS = new Set([465, 3465]);

/** Puertos submission con STARTTLS. */
export const SMTP_STARTTLS_PORTS = new Set([587]);

export const resolveSmtpPort = (raw: string | undefined): number =>
  Number(raw ?? 3465);

export const buildSmtpTransportOptions = (
  host: string,
  port: number,
  auth?: { user: string; pass: string },
): SMTPTransport.Options => {
  const secureOverride = process.env.SMTP_SECURE?.trim().toLowerCase();
  const secure =
    secureOverride === "true"
      ? true
      : secureOverride === "false"
        ? false
        : SMTP_IMPLICIT_TLS_PORTS.has(port);

  const requireTlsOverride = process.env.SMTP_REQUIRE_TLS?.trim().toLowerCase();
  const requireTLS =
    requireTlsOverride === "true"
      ? true
      : requireTlsOverride === "false"
        ? false
        : SMTP_STARTTLS_PORTS.has(port);

  const authMethod = process.env.SMTP_AUTH_METHOD?.trim();

  return {
    host,
    port,
    secure,
    requireTLS,
    ...(auth ? { auth } : {}),
    ...(authMethod ? { authMethod } : {}),
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== "false",
      servername: process.env.SMTP_TLS_SERVERNAME?.trim() || undefined,
    },
  };
};
