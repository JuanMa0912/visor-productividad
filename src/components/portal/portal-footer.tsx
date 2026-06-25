"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PORTAL_APP_VERSION } from "./portal-branding-header";

/**
 * Rutas en las que el footer global NO debe renderizarse porque la pagina
 * ya provee su propio footer/branding autocontenido (split-panel, hero, etc).
 */
const ROUTES_WITHOUT_FOOTER: readonly string[] = ["/login", "/margenes"];

/**
 * Pie de pagina global del Portal UAID.
 *
 * Se renderiza una sola vez en el RootLayout y aparece automaticamente en
 * todas las paginas. Contiene:
 *   - Nombre y version del portal (util para soporte y debugging).
 *   - Anio dinamico y autoria institucional.
 *
 * Diseno discreto en tonos slate para no competir con el contenido principal.
 *
 * NOTA: el bloque de "Soporte UAID" se removio porque ese canal de contacto
 * todavia no existe. Si en el futuro se habilita un email/canal de soporte,
 * agregar aqui un `<a href="mailto:...">` para que aparezca en todo el portal.
 */
export function PortalFooter() {
  const pathname = usePathname();
  const year = new Date().getFullYear();

  if (ROUTES_WITHOUT_FOOTER.includes(pathname ?? "")) {
    return null;
  }

  return (
    <footer className="mt-auto border-t border-slate-200/70 bg-white/70 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <p className="font-medium text-slate-600">
          Portal UAID{" "}
          <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-500">
            {PORTAL_APP_VERSION}
          </span>
        </p>

        <p className="text-slate-400">
          &copy; {year} Mercamio &middot; Herramientas internas de seguimiento
        </p>
      </div>
    </footer>
  );
}

/**
 * Componente auxiliar para que el footer pueda ofrecer un link al cronograma
 * desde paginas donde tiene sentido (ej. login, /secciones). Por ahora se deja
 * exportado pero no se usa por defecto: el footer estandar es minimalista.
 */
export function FooterCronogramaLink() {
  return (
    <Link
      href="/cronograma"
      className="text-slate-500 underline-offset-2 transition-colors hover:text-blue-700 hover:underline"
    >
      Cronograma de proyectos
    </Link>
  );
}
