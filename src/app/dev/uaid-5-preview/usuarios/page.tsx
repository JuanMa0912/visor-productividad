"use client";

import Link from "next/link";
import {
  BarChart3,
  Download,
  Filter,
  History,
  LayoutGrid,
  Pencil,
  Search,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { PortalBrandingHeader } from "@/components/portal/portal-branding-header";
import { useUaidSurfaceTheme } from "@/components/portal/uaid-surface-theme";
import {
  UaidControlAtmosphere,
  UaidCornerMarks,
  useUaidControlSurface,
} from "@/components/portal/uaid-control-chrome";
import {
  AdminUsuariosPageHeader,
  AdminUsuariosStatCard,
  AdminUsuariosToolCard,
  adminUsuariosPillClass,
  adminUsuariosPrimaryPillClass,
} from "@/app/admin/usuarios/admin-usuarios-shell";
import { PORTAL_APP_VERSION } from "@/lib/shared/uaid-brand";

const PREVIEW_USERS = [
  {
    username: "admin.demo",
    profile: "Administrador",
    sede: "—",
    lines: "—",
    sections: "Todas",
    state: "Activo" as const,
  },
  {
    username: "cajero.norte",
    profile: "Operación sede",
    sede: "Norte",
    lines: "Todas",
    sections: "Operación",
    state: "Activo" as const,
  },
  {
    username: "analista.venta",
    profile: "Comercial",
    sede: "Todas",
    lines: "Asaderos",
    sections: "Venta · Producto",
    state: "Activo" as const,
  },
  {
    username: "jefe.fruver",
    profile: "Producto",
    sede: "Centro",
    lines: "Fruver",
    sections: "Producto",
    state: "Inactivo" as const,
  },
];

/**
 * Preview visual de Admin → Usuarios (UAID 5.0) sin sesión.
 * Mismo lenguaje que la sala de control.
 */
export default function Uaid5UsuariosPreviewPage() {
  const { surface } = useUaidSurfaceTheme();
  const dark = surface === "dark";
  const { cardBg, muted, title, hairline, inputCls } = useUaidControlSurface();

  if (process.env.NODE_ENV !== "development") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-sm text-slate-500">
        Preview solo disponible en desarrollo.
      </div>
    );
  }

  return (
    <div className={dark ? "min-h-screen bg-[#070b14]" : "min-h-screen bg-slate-50"}>
      <div
        className={
          dark
            ? "border-b border-amber-400/30 bg-amber-500/15 px-4 py-2 text-center text-xs font-medium text-amber-100"
            : "border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900"
        }
      >
        Preview UAID {PORTAL_APP_VERSION} · Admin Usuarios · sin sesión · solo{" "}
        <span className="font-mono">next dev</span>
        {" · "}
        <Link
          href="/dev/uaid-5-preview"
          className="font-semibold underline underline-offset-2"
        >
          Sala de control
        </Link>
      </div>
      <PortalBrandingHeader
        canAccessCronograma
        isAdmin
        username="preview"
        sede="Demo"
        showSeccionesShortcut={false}
      />

      <UaidControlAtmosphere>
        <div className="relative mx-auto flex w-full max-w-[min(100%,72rem)] flex-col gap-6 px-4 py-5 pb-24 sm:px-6 lg:py-7">
          <AdminUsuariosPageHeader
            title="Usuarios"
            description="Gestiona roles, accesos por sección y actividad reciente del portal — misma sala de control que Secciones."
            actions={
              <>
                <span className={adminUsuariosPillClass}>
                  <LayoutGrid className="h-4 w-4" />
                  Ir a secciones
                </span>
                <span className={adminUsuariosPillClass}>Vaciar cache</span>
                <span className={adminUsuariosPrimaryPillClass}>
                  <UserPlus className="h-4 w-4" />
                  Nuevo usuario
                </span>
              </>
            }
          />

          <section className="grid gap-4 md:grid-cols-3">
            <AdminUsuariosStatCard
              code="ADM — 01"
              label="Total usuarios"
              value="48"
              hint="Cuentas registradas"
              accent="slate"
              badge={
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold tracking-[0.12em] uppercase ${
                    dark
                      ? "border-white/15 text-slate-300"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  +2 este mes
                </span>
              }
            />
            <AdminUsuariosStatCard
              code="ADM — 02"
              label="Usuarios activos"
              value="41"
              hint="Con acceso habilitado"
              accent="emerald"
              badge={
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] text-emerald-600 uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              }
            />
            <AdminUsuariosStatCard
              code="ADM — 03"
              label="Administradores"
              value="04"
              hint="Roles con permisos totales"
              accent="sky"
              badge={
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold tracking-[0.12em] text-sky-700 uppercase">
                  Nivel raíz
                </span>
              }
            />
          </section>

          <nav
            aria-label="Herramientas de administración (preview)"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <AdminUsuariosToolCard
              code="MOD — 01"
              label="Accesos"
              icon={History}
              accent="sky"
            />
            <AdminUsuariosToolCard
              code="MOD — 02"
              label="Uso de tableros"
              icon={BarChart3}
              accent="sky"
            />
            <AdminUsuariosToolCard
              code="MOD — 03"
              label="Auditoría"
              icon={ShieldAlert}
              accent="rose"
            />
            <AdminUsuariosToolCard
              code="MOD — 04"
              label="Descargas"
              icon={Download}
              accent="emerald"
            />
          </nav>

          <section
            className={`uaid-panel-rise relative overflow-hidden rounded-xl border shadow-sm ${cardBg} ${
              dark ? "border-sky-400/25" : "border-sky-200"
            }`}
            style={{
              boxShadow: dark
                ? "0 0 0 1px rgba(56,189,248,0.12), 0 20px 48px -28px rgba(56,189,248,0.35)"
                : "0 0 0 1px rgba(2,132,199,0.12), 0 20px 48px -28px rgba(14,165,233,0.28)",
            }}
          >
            <UaidCornerMarks color={dark ? "#38bdf8" : "#0284c7"} />
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-px"
              style={{
                background: `linear-gradient(90deg, transparent, ${
                  dark ? "#38bdf8" : "#0284c7"
                }, transparent)`,
              }}
            />
            <div
              className={`relative flex flex-col gap-4 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 ${hairline}`}
            >
              <div>
                <p
                  className={`text-[10px] font-bold tracking-[0.22em] uppercase ${muted}`}
                >
                  Directorio
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                  <span className={`font-semibold ${title}`}>Usuarios</span>
                  <span className={muted}>· {PREVIEW_USERS.length} registrados</span>
                </p>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2 sm:max-w-md sm:justify-end">
                <label className="relative block min-w-48 flex-1">
                  <Search
                    className={`pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 ${muted}`}
                  />
                  <input
                    type="search"
                    readOnly
                    placeholder="Filtrar…"
                    className={inputCls}
                  />
                </label>
                <span
                  className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-bold tracking-[0.14em] uppercase ${
                    dark
                      ? "border-white/10 text-slate-300"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <Filter className="h-3.5 w-3.5" />
                  Filtros
                </span>
              </div>
            </div>

            <div className="relative overflow-x-auto">
              <table className="w-full min-w-180 border-separate border-spacing-0 text-sm">
                <thead>
                  <tr
                    className={`text-left text-[10px] font-bold tracking-[0.16em] uppercase ${muted}`}
                  >
                    {[
                      "Usuario",
                      "Perfil",
                      "Sede",
                      "Líneas",
                      "Secciones",
                      "Estado",
                      "Acciones",
                    ].map((col) => (
                      <th
                        key={col}
                        className={`border-b px-3 py-3 first:pl-5 last:pr-5 last:text-right ${hairline}`}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PREVIEW_USERS.map((user, index) => (
                    <tr
                      key={user.username}
                      className="uaid-module-in transition hover:bg-sky-50/50"
                      style={{ animationDelay: `${80 + index * 40}ms` }}
                    >
                      <td className={`border-b px-3 py-3 first:pl-5 ${hairline}`}>
                        <div className="flex items-center gap-3">
                          <span
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                              index % 2 === 0 ? "bg-sky-600" : "bg-slate-700"
                            }`}
                          >
                            {user.username.slice(0, 2).toUpperCase()}
                          </span>
                          <span className={`font-semibold ${title}`}>
                            {user.username}
                          </span>
                        </div>
                      </td>
                      <td className={`border-b px-3 py-3 ${hairline} ${muted}`}>
                        {user.profile}
                      </td>
                      <td className={`border-b px-3 py-3 ${hairline} ${muted}`}>
                        {user.sede}
                      </td>
                      <td className={`border-b px-3 py-3 ${hairline} ${muted}`}>
                        {user.lines}
                      </td>
                      <td className={`border-b px-3 py-3 ${hairline} ${muted}`}>
                        {user.sections}
                      </td>
                      <td className={`border-b px-3 py-3 ${hairline}`}>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase ${
                            user.state === "Activo"
                              ? "text-emerald-600"
                              : muted
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              user.state === "Activo"
                                ? "bg-emerald-500"
                                : "bg-slate-400"
                            }`}
                          />
                          {user.state}
                        </span>
                      </td>
                      <td
                        className={`border-b px-3 py-3 pr-5 text-right ${hairline}`}
                      >
                        <span className="inline-flex rounded-lg p-1.5 text-sky-600">
                          <Pencil className="h-4 w-4" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </UaidControlAtmosphere>
    </div>
  );
}
