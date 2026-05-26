import { NextResponse } from "next/server";
import {
  getSessionCookieOptions,
  requireAuthSession,
} from "@/lib/auth";
import { fetchCronograma } from "@/lib/notion/cronograma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CACHE_CONTROL = "private, no-store";

export async function GET() {
  const session = await requireAuthSession();
  if (!session) {
    return NextResponse.json(
      { error: "No autorizado." },
      { status: 401, headers: { "Cache-Control": CACHE_CONTROL } },
    );
  }

  const withSession = (response: NextResponse) => {
    response.cookies.set(
      "vp_session",
      session.token,
      getSessionCookieOptions(session.expiresAt),
    );
    if (!response.headers.has("Cache-Control")) {
      response.headers.set("Cache-Control", CACHE_CONTROL);
    }
    return response;
  };

  const pageId = process.env.NOTION_CRONOGRAMA_PAGE_ID?.trim();
  if (!pageId) {
    return withSession(
      NextResponse.json(
        {
          error:
            "Falta NOTION_CRONOGRAMA_PAGE_ID en el entorno. Configura .env.local con el ID de la página de Notion.",
        },
        { status: 500 },
      ),
    );
  }

  try {
    const payload = await fetchCronograma(pageId);
    return withSession(NextResponse.json(payload));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error desconocido al consultar Notion.";
    console.error("[/api/cronograma] Error consultando Notion:", error);
    return withSession(
      NextResponse.json(
        {
          error:
            "No fue posible obtener el cronograma desde Notion. Verifica el token, los permisos de la integración y el ID de la página.",
          detail: message,
        },
        { status: 502 },
      ),
    );
  }
}
