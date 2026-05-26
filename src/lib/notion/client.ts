import { Client } from "@notionhq/client";

let cachedClient: Client | null = null;

export const getNotionClient = (): Client => {
  if (cachedClient) return cachedClient;
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Falta NOTION_TOKEN en el entorno. Configura .env.local con el token de la integración interna de Notion.",
    );
  }
  cachedClient = new Client({ auth: token });
  return cachedClient;
};

/** Normaliza un ID de Notion al formato canónico con guiones (8-4-4-4-12). */
export const normalizeNotionId = (raw: string): string => {
  const clean = raw.replace(/[^a-fA-F0-9]/g, "");
  if (clean.length !== 32) return raw;
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
};
