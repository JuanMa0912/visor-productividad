"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  LayoutGrid,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { AppTopBar } from "@/components/portal/app-top-bar";
import { Button } from "@/components/ui/button";
import type { AdminAuditListResponse, AdminAuditRow } from "@/app/api/admin/audit/route";
import type {
  FailedLoginListResponse,
  FailedLoginRow,
} from "@/app/api/admin/login-failures/route";

const formatAbsolute = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("es-CO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const actionLabel = (action: string) => {
  switch (action) {
    case "create":
      return "Alta";
    case "update":
      return "Cambio";
    case "delete":
      return "Baja";
    case "password_reset":
      return "Reset clave";
    default:
      return action;
  }
};

const failureLabel = (reason: string) => {
  switch (reason) {
    case "unknown_user":
      return "Usuario inexistente";
    case "bad_password":
      return "Clave incorrecta";
    case "inactive":
      return "Cuenta inactiva";
    case "rate_limited":
      return "Rate limit";
    default:
      return reason;
  }
};

export default function AdminAuditPage() {
  const router = useRouter();
  const [auditRows, setAuditRows] = useState<AdminAuditRow[]>([]);
  const [failRows, setFailRows] = useState<FailedLoginRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [auditRes, failRes] = await Promise.all([
        fetch("/api/admin/audit?limit=80"),
        fetch("/api/admin/login-failures?limit=80"),
      ]);
      if (auditRes.status === 401 || failRes.status === 401) {
        router.replace("/login");
        return;
      }
      if (auditRes.status === 403 || failRes.status === 403) {
        router.replace("/secciones");
        return;
      }
      const auditPayload = (await auditRes.json()) as AdminAuditListResponse & {
        error?: string;
      };
      const failPayload = (await failRes.json()) as FailedLoginListResponse & {
        error?: string;
      };
      if (!auditRes.ok && auditRes.status !== 503) {
        throw new Error(auditPayload.error ?? "No se pudo cargar auditoría.");
      }
      setAuditRows(auditPayload.rows ?? []);
      setFailRows(failPayload.rows ?? []);
      if (auditRes.status === 503 || failRes.status === 503) {
        setError(
          "Aplica la migración db/migrations/20260715_user_audit_trail.sql en la BD.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen bg-slate-50">
      <AppTopBar backHref="/admin/usuarios" backLabel="Volver a usuarios" />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500 hover:text-slate-800"
            >
              <LayoutGrid className="h-3 w-3" />
              Admin · Usuarios
            </Link>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
              <ShieldAlert className="h-7 w-7 text-rose-600" />
              Auditoría
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Cambios de permisos/estado hechos por admins e intentos de login
              fallidos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const escape = (value: string) =>
                  `"${value.replaceAll('"', '""')}"`;
                const auditCsv = [
                  [
                    "createdAt",
                    "actor",
                    "target",
                    "action",
                    "changedFields",
                    "actorIp",
                  ].join(","),
                  ...auditRows.map((row) =>
                    [
                      escape(row.createdAt),
                      escape(row.actorUsername ?? ""),
                      escape(row.targetUsername),
                      escape(row.action),
                      escape(row.changedFields.join("|")),
                      escape(row.actorIp ?? ""),
                    ].join(","),
                  ),
                ].join("\n");
                const failCsv = [
                  ["loggedAt", "username", "failureReason", "ip"].join(","),
                  ...failRows.map((row) =>
                    [
                      escape(row.loggedAt),
                      escape(row.username),
                      escape(row.failureReason),
                      escape(row.ip ?? ""),
                    ].join(","),
                  ),
                ].join("\n");
                const blob = new Blob(
                  [
                    "# admin_audit\n",
                    auditCsv,
                    "\n\n# login_failures\n",
                    failCsv,
                    "\n",
                  ],
                  { type: "text/csv;charset=utf-8" },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `auditoria-usuarios-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              disabled={loading || (auditRows.length === 0 && failRows.length === 0)}
              className="gap-1.5 border-slate-200 bg-white"
            >
              Exportar CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5 border-slate-200 bg-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Actualizar
            </Button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando…
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Cambios de usuario (admin)
                </h2>
                <p className="text-xs text-slate-500">
                  Últimos {auditRows.length} eventos
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Cuándo</th>
                      <th className="px-4 py-3">Actor</th>
                      <th className="px-4 py-3">Objetivo</th>
                      <th className="px-4 py-3">Acción</th>
                      <th className="px-4 py-3">Campos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                          {formatAbsolute(row.createdAt)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {row.actorUsername ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          {row.targetUserId ? (
                            <Link
                              href={`/admin/usuarios/${row.targetUserId}/metricas`}
                              className="font-medium text-sky-700 hover:underline"
                            >
                              {row.targetUsername}
                            </Link>
                          ) : (
                            <span className="text-slate-700">
                              {row.targetUsername}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {actionLabel(row.action)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {row.changedFields.join(", ") || "—"}
                        </td>
                      </tr>
                    ))}
                    {auditRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-8 text-center text-sm text-slate-500"
                        >
                          Sin eventos aún. Aparecerán al crear/editar/borrar
                          usuarios.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-base font-semibold text-slate-900">
                  Logins fallidos
                </h2>
                <p className="text-xs text-slate-500">
                  Últimos {failRows.length} intentos
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Cuándo</th>
                      <th className="px-4 py-3">Usuario</th>
                      <th className="px-4 py-3">Motivo</th>
                      <th className="px-4 py-3">IP audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {failRows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                          {formatAbsolute(row.loggedAt)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {row.username}
                        </td>
                        <td className="px-4 py-2.5 text-rose-700">
                          {failureLabel(row.failureReason)}
                        </td>
                        <td className="max-w-[14rem] truncate px-4 py-2.5 font-mono text-xs text-slate-500">
                          {row.ip ?? "—"}
                        </td>
                      </tr>
                    ))}
                    {failRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-center text-sm text-slate-500"
                        >
                          Sin fallos registrados.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a usuarios
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
