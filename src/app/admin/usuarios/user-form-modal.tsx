"use client";

import type { RefObject } from "react";
import { Info, UserCog, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordStrengthMeter } from "@/components/portal/password-strength-meter";
import type { PortalProfileId } from "@/lib/auth/types";
import {
  PORTAL_PROFILE_OPTIONS,
  portalProfileRequiresAssignedSedes,
} from "@/lib/shared/portal-profiles";
import {
  PORTAL_SUBSECTIONS_BY_SECTION,
  PORTAL_SECTIONS,
} from "@/lib/shared/portal-sections";
import { DEFAULT_LINES } from "@/lib/shared/constants";

export type UserFormState = {
  id?: string;
  username: string;
  portalProfile: PortalProfileId;
  role: "admin" | "user";
  sede: string;
  allowedSedes: string[];
  allowedLines: string[];
  allowedDashboards: string[];
  allowedSubdashboards: string[];
  specialRoles: string[];
  password: string;
  is_active: boolean;
};

type Option = { id: string; label: string };

type UserFormModalProps = {
  open: boolean;
  formState: UserFormState;
  setFormState: React.Dispatch<React.SetStateAction<UserFormState>>;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  isAdminProfile: boolean;
  canEditManualPermissions: boolean;
  selectedProfileSummary: string;
  sedeOptions: string[];
  sectionOptions: Option[];
  subsectionLabels: Record<string, string>;
  specialRoleOptions: Option[];
  passwordInputRef: RefObject<HTMLInputElement | null>;
  onPortalProfileChange: (profile: PortalProfileId) => void;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const SECTION_TITLE_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400";

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-4 sm:p-5">
      <div className="mb-4">
        <h3 className={SECTION_TITLE_CLASS}>{title}</h3>
        {description ? (
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FieldLabel({
  htmlFor,
  children,
  hint,
}: {
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-sm font-medium text-slate-700">{children}</span>
      {hint ? (
        <span className="mt-0.5 block text-xs font-normal text-slate-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function CheckboxChip({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition ${
        disabled
          ? "cursor-not-allowed border-slate-100 bg-slate-50/80 opacity-60"
          : checked
            ? "border-indigo-200 bg-indigo-50/80 text-indigo-950"
            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200 disabled:cursor-not-allowed"
      />
      <span className="min-w-0 font-medium leading-snug">{label}</span>
    </label>
  );
}

function CheckboxGrid({
  options,
  selected,
  disabled,
  onToggle,
  maxHeightClass = "max-h-36",
  columnsClass = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  options: { id: string; label: string }[];
  selected: string[];
  disabled?: boolean;
  onToggle: (id: string, checked: boolean) => void;
  maxHeightClass?: string;
  columnsClass?: string;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-2 overflow-y-auto ${maxHeightClass} ${columnsClass}`}
    >
      {options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <CheckboxChip
            key={option.id}
            checked={checked}
            disabled={disabled}
            label={option.label}
            onChange={() => onToggle(option.id, checked)}
          />
        );
      })}
    </div>
  );
}

export function UserFormModal({
  open,
  formState,
  setFormState,
  onClose,
  onSave,
  saving,
  isAdminProfile,
  canEditManualPermissions,
  selectedProfileSummary,
  sedeOptions,
  sectionOptions,
  subsectionLabels,
  specialRoleOptions,
  passwordInputRef,
  onPortalProfileChange,
}: UserFormModalProps) {
  if (!open) return null;

  const isEditing = Boolean(formState.id);
  const sedeHint = isAdminProfile
    ? "Los perfiles admin tienen acceso a todas las sedes."
    : portalProfileRequiresAssignedSedes(formState.portalProfile)
      ? "Selecciona una o más sedes (sin «Todas»)."
      : "Selecciona al menos una sede.";

  const sedeOptionsMapped = sedeOptions.map((sede) => ({
    id: sede,
    label: sede,
  }));

  const toggleSede = (sede: string, checked: boolean) => {
    setFormState((prev) => {
      if (checked) {
        return {
          ...prev,
          allowedSedes: prev.allowedSedes.filter((id) => id !== sede),
        };
      }
      return {
        ...prev,
        allowedSedes: [...prev.allowedSedes, sede],
      };
    });
  };

  const setAllSedes = (selectAll: boolean) => {
    if (isAdminProfile) return;
    setFormState((prev) => ({
      ...prev,
      allowedSedes: selectAll ? [...sedeOptions] : [],
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-user-form-title"
    >
      <div
        className="relative my-4 flex w-full max-w-2xl max-h-[min(92vh,820px)] flex-col overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xl sm:my-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md shadow-indigo-600/25">
            {isEditing ? (
              <UserCog className="h-5 w-5" strokeWidth={2} />
            ) : (
              <UserPlus className="h-5 w-5" strokeWidth={2} />
            )}
          </div>
          <div className="min-w-0 flex-1 pr-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Administración
            </p>
            <h2
              id="admin-user-form-title"
              className="mt-1 text-xl font-bold tracking-tight text-slate-900"
            >
              {isEditing ? "Editar usuario" : "Nuevo usuario"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {isEditing
                ? "Actualiza credenciales, perfil y permisos del usuario."
                : "Crea una cuenta con perfil del portal y sedes asignadas."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <FormSection
            title="Datos de la cuenta"
            description="Identificador de acceso y estado de la cuenta."
          >
            <div>
              <FieldLabel htmlFor="admin-user-username">Usuario</FieldLabel>
              <input
                id="admin-user-username"
                value={formState.username}
                onChange={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
                className={`${INPUT_CLASS} mt-1.5`}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel
                  htmlFor="admin-user-password"
                  hint={
                    isEditing
                      ? "Déjala vacía para mantener la contraseña actual."
                      : "Mínimo 8 caracteres según la política del portal."
                  }
                >
                  Contraseña
                </FieldLabel>
                <input
                  id="admin-user-password"
                  ref={passwordInputRef}
                  type="password"
                  value={formState.password}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  onInput={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      password: (e.target as HTMLInputElement).value,
                    }))
                  }
                  className={`${INPUT_CLASS} mt-1.5 vp-sync-autofill`}
                  autoComplete="new-password"
                />
                <div className="mt-3 rounded-lg border border-slate-200/80 bg-white px-3 py-3">
                  <PasswordStrengthMeter password={formState.password} compact />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-emerald-200 hover:bg-emerald-50/30 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={formState.is_active}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      is_active: e.target.checked,
                    }))
                  }
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-200"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">
                    Cuenta activa
                  </span>
                  <span className="block text-xs text-slate-500">
                    Si se desactiva, el usuario no podrá iniciar sesión.
                  </span>
                </span>
              </label>
            </div>
          </FormSection>

          <FormSection
            title="Perfil y sedes"
            description="El perfil define las secciones visibles del portal."
          >
            <div>
              <FieldLabel htmlFor="admin-user-profile">Perfil del portal</FieldLabel>
              <select
                id="admin-user-profile"
                value={formState.portalProfile}
                onChange={(e) =>
                  onPortalProfileChange(e.target.value as PortalProfileId)
                }
                className={`${INPUT_CLASS} mt-1.5`}
              >
                {PORTAL_PROFILE_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              {!canEditManualPermissions && selectedProfileSummary ? (
                <div className="mt-3 flex gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3.5 py-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <p className="text-xs leading-relaxed text-indigo-900/85">
                    {selectedProfileSummary}
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <FieldLabel hint={sedeHint}>Sedes permitidas</FieldLabel>
                {!isAdminProfile ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllSedes(true)}
                      className="text-xs font-medium text-indigo-600 transition hover:text-indigo-700"
                    >
                      Marcar todas
                    </button>
                    <span className="text-slate-300" aria-hidden>
                      |
                    </span>
                    <button
                      type="button"
                      onClick={() => setAllSedes(false)}
                      className="text-xs font-medium text-slate-500 transition hover:text-slate-700"
                    >
                      Quitar todas
                    </button>
                  </div>
                ) : null}
              </div>
              <CheckboxGrid
                options={sedeOptionsMapped}
                selected={formState.allowedSedes}
                disabled={isAdminProfile}
                onToggle={toggleSede}
                maxHeightClass="max-h-40"
              />
              {!isAdminProfile ? (
                <p className="mt-2 text-xs text-slate-500">
                  {formState.allowedSedes.length === 0
                    ? "Ninguna sede seleccionada."
                    : `${formState.allowedSedes.length} sede(s) seleccionada(s).`}
                </p>
              ) : null}
            </div>
          </FormSection>

          {canEditManualPermissions ? (
            <FormSection
              title="Permisos personalizados"
              description="Solo aplica al perfil Personalizado. Vacío significa acceso completo en esa categoría."
            >
              <div>
                <FieldLabel hint="Vacío = todas las secciones">
                  Secciones permitidas
                </FieldLabel>
                <div className="mt-2">
                  <CheckboxGrid
                    options={sectionOptions}
                    selected={formState.allowedDashboards}
                    onToggle={(id, checked) =>
                      setFormState((prev) => ({
                        ...prev,
                        allowedDashboards: checked
                          ? prev.allowedDashboards.filter((entry) => entry !== id)
                          : [...prev.allowedDashboards, id],
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <FieldLabel hint="Vacío = todos los subtableros">
                  Subtableros permitidos
                </FieldLabel>
                <div className="mt-2 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                  {PORTAL_SECTIONS.map((section) => (
                    <div key={section.id}>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        {section.label}
                      </p>
                      <CheckboxGrid
                        options={PORTAL_SUBSECTIONS_BY_SECTION[section.id].map(
                          (subId) => ({
                            id: subId,
                            label: subsectionLabels[subId] ?? subId,
                          }),
                        )}
                        selected={formState.allowedSubdashboards}
                        onToggle={(id, checked) =>
                          setFormState((prev) => ({
                            ...prev,
                            allowedSubdashboards: checked
                              ? prev.allowedSubdashboards.filter(
                                  (entry) => entry !== id,
                                )
                              : [...prev.allowedSubdashboards, id],
                          }))
                        }
                        maxHeightClass="max-h-none"
                        columnsClass="sm:grid-cols-2"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <FieldLabel
                  hint="Rotación se controla por subtablero; ABCD y S.inventario son roles legacy."
                >
                  Roles especiales
                </FieldLabel>
                <div className="mt-2">
                  <CheckboxGrid
                    options={specialRoleOptions}
                    selected={formState.specialRoles}
                    onToggle={(id, checked) =>
                      setFormState((prev) => ({
                        ...prev,
                        specialRoles: checked
                          ? prev.specialRoles.filter((entry) => entry !== id)
                          : [...prev.specialRoles, id],
                      }))
                    }
                    maxHeightClass="max-h-32"
                  />
                </div>
              </div>

              <div>
                <FieldLabel hint="Vacío = todas las líneas">
                  Líneas permitidas
                </FieldLabel>
                <div className="mt-2">
                  <CheckboxGrid
                    options={DEFAULT_LINES.map((line) => ({
                      id: line.id,
                      label: line.name,
                    }))}
                    selected={formState.allowedLines}
                    onToggle={(id, checked) =>
                      setFormState((prev) => ({
                        ...prev,
                        allowedLines: checked
                          ? prev.allowedLines.filter((entry) => entry !== id)
                          : [...prev.allowedLines, id],
                      }))
                    }
                    maxHeightClass="max-h-40"
                  />
                </div>
              </div>
            </FormSection>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-slate-200"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-700"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear usuario"}
          </Button>
        </div>
      </div>
    </div>
  );
}
