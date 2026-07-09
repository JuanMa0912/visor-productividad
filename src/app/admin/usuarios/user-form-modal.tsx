"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import {
  Eye,
  EyeOff,
  Info,
  Loader2,
  UserCog,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper, StepperStep } from "@/components/ui/stepper";
import { PasswordStrengthMeter } from "@/components/portal/password-strength-meter";
import type { PortalProfileId } from "@/lib/auth/types";
import {
  getPortalProfileLabel,
  getAsaderoDashboardOptions,
  PORTAL_PROFILE_OPTIONS,
  portalProfileRequiresAssignedSedes,
} from "@/lib/shared/portal-profiles";
import {
  PORTAL_SUBSECTIONS_BY_SECTION,
  PORTAL_SECTIONS,
} from "@/lib/shared/portal-sections";
import { DEFAULT_LINES } from "@/lib/shared/constants";
import { cn } from "@/lib/shared/utils";
import { UserFormSedePicker } from "@/app/admin/usuarios/user-form-sede-picker";
import {
  getWizardSteps,
  hasFieldErrors,
  serializeUserFormState,
  validateWizardStep,
  type UserFormFieldErrors,
  type UserFormState,
  type UserFormWizardStep,
} from "@/app/admin/usuarios/user-form-validation";

export type { UserFormState };

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
  canEditDashboardPermissions: boolean;
  dashboardPermissionsOnly: boolean;
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

const INPUT_ERROR_CLASS =
  "border-red-300 focus:border-red-400 focus:ring-red-100";

const STEP_LABELS: Record<UserFormWizardStep, string> = {
  account: "Cuenta",
  profile: "Perfil",
  permissions: "Permisos",
  summary: "Resumen",
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-red-600" role="alert">
      {message}
    </p>
  );
}

function CheckboxChip({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition",
        checked
          ? "border-indigo-200 bg-indigo-50/80 text-indigo-950"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-200"
      />
      <span className="min-w-0 font-medium leading-snug">{label}</span>
    </label>
  );
}

function CheckboxGrid({
  options,
  selected,
  onToggle,
  maxHeightClass = "max-h-36",
}: {
  options: Option[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  maxHeightClass?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2",
        maxHeightClass,
      )}
    >
      {options.map((option) => {
        const checked = selected.includes(option.id);
        return (
          <CheckboxChip
            key={option.id}
            checked={checked}
            label={option.label}
            onChange={() => onToggle(option.id, checked)}
          />
        );
      })}
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </dt>
      <dd className="text-sm font-medium text-slate-800 sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
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
  canEditDashboardPermissions,
  dashboardPermissionsOnly,
  selectedProfileSummary,
  sedeOptions,
  sectionOptions,
  subsectionLabels,
  specialRoleOptions,
  passwordInputRef,
  onPortalProfileChange,
}: UserFormModalProps) {
  const isEditing = Boolean(formState.id);
  const wizardSteps = useMemo(
    () => getWizardSteps(formState.portalProfile),
    [formState.portalProfile],
  );

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<UserFormFieldErrors>({});
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [permissionsPanels, setPermissionsPanels] = useState({
    sections: true,
    subsections: false,
    roles: false,
    lines: false,
  });

  const currentStep = wizardSteps[currentStepIndex] ?? "account";
  const isSummaryStep = currentStep === "summary";
  const isFirstStep = currentStepIndex === 0;

  const isDirty =
    open && initialSnapshot.length > 0
      ? serializeUserFormState(formState) !== initialSnapshot
      : false;

  useEffect(() => {
    if (!open) return;
    setInitialSnapshot(serializeUserFormState(formState));
    setCurrentStepIndex(0);
    setFieldErrors({});
    setDiscardOpen(false);
    setShowPassword(false);
    setPermissionsPanels({
      sections: true,
      subsections: false,
      roles: false,
      lines: false,
    });
    // Captura el estado inicial al abrir el modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (currentStepIndex >= wizardSteps.length) {
      setCurrentStepIndex(Math.max(0, wizardSteps.length - 1));
    }
  }, [currentStepIndex, wizardSteps.length]);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (isDirty) {
      setDiscardOpen(true);
      return;
    }
    onClose();
  }, [isDirty, onClose, saving]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) return;
    requestClose();
  };

  const runStepValidation = (step: UserFormWizardStep): boolean => {
    const errors = validateWizardStep(step, formState, isEditing);
    setFieldErrors(errors);
    return !hasFieldErrors(errors);
  };

  const goNext = () => {
    if (isSummaryStep) return;
    if (!runStepValidation(currentStep)) return;
    setFieldErrors({});
    setCurrentStepIndex((index) => Math.min(index + 1, wizardSteps.length - 1));
  };

  const goBack = () => {
    setFieldErrors({});
    setCurrentStepIndex((index) => Math.max(index - 1, 0));
  };

  const handleConfirmSave = useCallback(() => {
    const accountErrors = validateWizardStep("account", formState, isEditing);
    const profileErrors = validateWizardStep("profile", formState, isEditing);
    const merged = { ...accountErrors, ...profileErrors };
    setFieldErrors(merged);
    if (hasFieldErrors(accountErrors)) {
      setCurrentStepIndex(0);
      return;
    }
    if (hasFieldErrors(profileErrors)) {
      setCurrentStepIndex(1);
      return;
    }
    onSave();
  }, [formState, isEditing, onSave]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "Enter" &&
        isSummaryStep &&
        !saving
      ) {
        event.preventDefault();
        handleConfirmSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isSummaryStep, saving, handleConfirmSave]);

  const sedeSummary =
    formState.portalProfile === "admin"
      ? "Todas (admin)"
      : formState.allowedSedes.length === 0
        ? "Ninguna"
        : formState.allowedSedes.join(", ");

  const permissionsSummary = canEditManualPermissions
    ? [
        `${formState.allowedDashboards.length || "Todas"} secciones`,
        `${formState.allowedSubdashboards.length || "Todos"} subtableros`,
        `${formState.specialRoles.length || "Ninguno"} roles especiales`,
        `${formState.allowedLines.length || "Todas"} líneas`,
      ].join(" · ")
    : canEditDashboardPermissions
      ? [
          `${formState.allowedDashboards.length || "Todas"} secciones`,
          `${formState.allowedSubdashboards.length || "Todos"} subtableros`,
          "Línea fija: Asadero",
        ].join(" · ")
      : selectedProfileSummary;

  const asaderoDashboardOptions = useMemo(
    () => getAsaderoDashboardOptions(),
    [],
  );
  const visibleSectionOptions = useMemo(
    () =>
      dashboardPermissionsOnly
        ? sectionOptions.filter((option) =>
            asaderoDashboardOptions.sections.includes(
              option.id as (typeof asaderoDashboardOptions.sections)[number],
            ),
          )
        : sectionOptions,
    [asaderoDashboardOptions.sections, dashboardPermissionsOnly, sectionOptions],
  );
  const visiblePortalSections = useMemo(
    () =>
      dashboardPermissionsOnly
        ? PORTAL_SECTIONS.filter((section) =>
            asaderoDashboardOptions.sections.includes(section.id),
          )
        : PORTAL_SECTIONS,
    [asaderoDashboardOptions.sections, dashboardPermissionsOnly],
  );

  const renderStepContent = () => {
    if (currentStep === "account") {
      return (
        <div className="space-y-4">
          <div>
            <label
              htmlFor="admin-user-username"
              className="text-sm font-medium text-slate-700"
            >
              Usuario
            </label>
            <input
              id="admin-user-username"
              value={formState.username}
              onChange={(e) => {
                setFieldErrors((prev) => ({ ...prev, username: undefined }));
                setFormState((prev) => ({
                  ...prev,
                  username: e.target.value,
                }));
              }}
              className={cn(
                INPUT_CLASS,
                "mt-1.5",
                fieldErrors.username ? INPUT_ERROR_CLASS : "",
              )}
              autoComplete="off"
              aria-invalid={Boolean(fieldErrors.username)}
            />
            <FieldError message={fieldErrors.username} />
          </div>

          <div>
            <label
              htmlFor="admin-user-password"
              className="text-sm font-medium text-slate-700"
            >
              Contraseña
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              {isEditing
                ? "Déjala vacía para mantener la contraseña actual."
                : "Obligatoria al crear. Debe cumplir la política del portal."}
            </p>
            <div className="relative mt-1.5">
              <input
                id="admin-user-password"
                ref={passwordInputRef}
                type={showPassword ? "text" : "password"}
                value={formState.password}
                onChange={(e) => {
                  setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  setFormState((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }));
                }}
                onInput={(e) =>
                  setFormState((prev) => ({
                    ...prev,
                    password: (e.target as HTMLInputElement).value,
                  }))
                }
                className={cn(
                  INPUT_CLASS,
                  "pr-10",
                  fieldErrors.password ? INPUT_ERROR_CLASS : "",
                )}
                autoComplete="new-password"
                aria-invalid={Boolean(fieldErrors.password)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <FieldError message={fieldErrors.password} />
            <div className="mt-3 rounded-lg border border-slate-200/80 bg-white px-3 py-3">
              <PasswordStrengthMeter password={formState.password} compact />
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-slate-300">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800">
                Cuenta activa
              </span>
              <span className="block text-xs text-slate-500">
                Si se desactiva, el usuario no podrá iniciar sesión.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={formState.is_active}
              onClick={() =>
                setFormState((prev) => ({
                  ...prev,
                  is_active: !prev.is_active,
                }))
              }
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-100",
                formState.is_active ? "bg-emerald-500" : "bg-slate-200",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                  formState.is_active ? "translate-x-5" : "translate-x-0",
                )}
              />
            </button>
          </label>
        </div>
      );
    }

    if (currentStep === "profile") {
      return (
        <div className="space-y-5">
          <div>
            <label
              htmlFor="admin-user-profile"
              className="text-sm font-medium text-slate-700"
            >
              Perfil del portal
            </label>
            <Select
              value={formState.portalProfile}
              onValueChange={(value) => {
                setFieldErrors((prev) => ({ ...prev, allowedSedes: undefined }));
                onPortalProfileChange(value as PortalProfileId);
              }}
            >
              <SelectTrigger
                id="admin-user-profile"
                className="mt-1.5 h-auto min-h-10 w-full rounded-lg border-slate-200 bg-white py-2.5 text-left shadow-sm focus:ring-indigo-100"
              >
                <SelectValue placeholder="Selecciona un perfil">
                  {getPortalProfileLabel(formState.portalProfile)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="max-h-72 w-[var(--radix-select-trigger-width)]"
              >
                {PORTAL_PROFILE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    textValue={option.label}
                    className="items-start py-2.5 pr-8"
                  >
                    <div className="flex flex-col gap-0.5 text-left">
                      <span className="font-semibold text-slate-900">
                        {option.label}
                      </span>
                      <span className="text-xs leading-snug font-normal text-slate-500">
                        {option.summary}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!canEditDashboardPermissions && selectedProfileSummary ? (
              <div className="mt-3 flex gap-2.5 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3.5 py-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                <p className="text-xs leading-relaxed text-indigo-900/85">
                  {selectedProfileSummary}
                </p>
              </div>
            ) : null}
          </div>

          <div>
            <p className="text-sm font-medium text-slate-700">Sedes permitidas</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {isAdminProfile
                ? "Los perfiles admin tienen acceso a todas las sedes."
                : portalProfileRequiresAssignedSedes(formState.portalProfile)
                  ? "Selecciona una o más sedes concretas (sin «Todas»)."
                  : "Selecciona al menos una sede."}
            </p>
            <div className="mt-2">
              <UserFormSedePicker
                options={sedeOptions}
                selected={formState.allowedSedes}
                disabled={isAdminProfile}
                error={fieldErrors.allowedSedes}
                onToggle={(sede, checked) => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    allowedSedes: undefined,
                  }));
                  setFormState((prev) => {
                    if (checked) {
                      return {
                        ...prev,
                        allowedSedes: prev.allowedSedes.filter(
                          (id) => id !== sede,
                        ),
                      };
                    }
                    return {
                      ...prev,
                      allowedSedes: [...prev.allowedSedes, sede],
                    };
                  });
                }}
                onSelectAll={() => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    allowedSedes: undefined,
                  }));
                  setFormState((prev) => ({
                    ...prev,
                    allowedSedes: [...sedeOptions],
                  }));
                }}
                onClearAll={() => {
                  setFieldErrors((prev) => ({
                    ...prev,
                    allowedSedes: undefined,
                  }));
                  setFormState((prev) => ({ ...prev, allowedSedes: [] }));
                }}
              />
            </div>
          </div>
        </div>
      );
    }

    if (currentStep === "permissions") {
      return (
        <Stepper>
          {dashboardPermissionsOnly ? (
            <p className="mb-3 rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
              Perfil <span className="font-semibold">Asadero</span>: puedes quitar
              tableros, pero la línea y la categoría siguen fijas en asadero.
            </p>
          ) : null}
          <StepperStep
            index={1}
            title="Secciones permitidas"
            description={dashboardPermissionsOnly ? "Solo tableros del perfil Asadero" : "Vacío = todas"}
            summary={
              formState.allowedDashboards.length === 0
                ? "Todas las secciones"
                : `${formState.allowedDashboards.length} sección(es)`
            }
            isOpen={permissionsPanels.sections}
            onToggle={() =>
              setPermissionsPanels((prev) => ({
                ...prev,
                sections: !prev.sections,
              }))
            }
            accentClassName="bg-indigo-600 text-white"
          >
            <CheckboxGrid
              options={visibleSectionOptions}
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
          </StepperStep>

          <StepperStep
            index={2}
            title="Subtableros permitidos"
            description="Vacío = todos"
            summary={
              formState.allowedSubdashboards.length === 0
                ? "Todos los subtableros"
                : `${formState.allowedSubdashboards.length} subtablero(s)`
            }
            isOpen={permissionsPanels.subsections}
            onToggle={() =>
              setPermissionsPanels((prev) => ({
                ...prev,
                subsections: !prev.subsections,
              }))
            }
            accentClassName="bg-indigo-600 text-white"
          >
            <div className="space-y-3">
              {visiblePortalSections.map((section) => (
                <div key={section.id}>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    {section.label}
                  </p>
                  <CheckboxGrid
                    options={PORTAL_SUBSECTIONS_BY_SECTION[section.id]
                      .filter((subId) =>
                        dashboardPermissionsOnly
                          ? asaderoDashboardOptions.subsections.includes(subId)
                          : true,
                      )
                      .map((subId) => ({
                        id: subId,
                        label: subsectionLabels[subId] ?? subId,
                      }))}
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
                  />
                </div>
              ))}
            </div>
          </StepperStep>

          {canEditManualPermissions ? (
            <>
          <StepperStep
            index={3}
            title="Roles especiales"
            description="Compatibilidad y extras"
            summary={
              formState.specialRoles.length === 0
                ? "Ningún rol extra"
                : `${formState.specialRoles.length} rol(es)`
            }
            isOpen={permissionsPanels.roles}
            onToggle={() =>
              setPermissionsPanels((prev) => ({ ...prev, roles: !prev.roles }))
            }
            accentClassName="bg-indigo-600 text-white"
          >
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
          </StepperStep>

          <StepperStep
            index={4}
            title="Líneas permitidas"
            description="Vacío = todas"
            summary={
              formState.allowedLines.length === 0
                ? "Todas las líneas"
                : `${formState.allowedLines.length} línea(s)`
            }
            isOpen={permissionsPanels.lines}
            onToggle={() =>
              setPermissionsPanels((prev) => ({ ...prev, lines: !prev.lines }))
            }
            accentClassName="bg-indigo-600 text-white"
          >
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
          </StepperStep>
            </>
          ) : null}
        </Stepper>
      );
    }

    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-2">
        <dl>
          <SummaryRow label="Usuario" value={formState.username.trim() || "—"} />
          <SummaryRow
            label="Perfil"
            value={getPortalProfileLabel(formState.portalProfile)}
          />
          <SummaryRow label="Sedes" value={sedeSummary} />
          <SummaryRow
            label="Estado"
            value={formState.is_active ? "Activa" : "Inactiva"}
          />
          <SummaryRow
            label="Contraseña"
            value={
              formState.password.trim()
                ? "Se actualizará"
                : isEditing
                  ? "Sin cambios"
                  : "—"
            }
          />
          {canEditDashboardPermissions ? (
            <SummaryRow label="Permisos" value={permissionsSummary} />
          ) : (
            <SummaryRow label="Acceso" value={selectedProfileSummary} />
          )}
        </dl>
        <p className="border-t border-slate-100 py-3 text-xs text-slate-500">
          Revisa los datos antes de confirmar. Atajo:{" "}
          <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl+Enter
          </kbd>
        </p>
      </div>
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[min(92vh,820px)] max-w-2xl flex-col overflow-hidden p-0"
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
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
              <DialogHeader className="mt-1 gap-1">
                <DialogTitle className="text-xl">
                  {isEditing ? "Editar usuario" : "Nuevo usuario"}
                </DialogTitle>
                <DialogDescription>
                  Paso {currentStepIndex + 1} de {wizardSteps.length}:{" "}
                  {STEP_LABELS[currentStep]}
                </DialogDescription>
              </DialogHeader>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="shrink-0 border-b border-slate-100 px-5 py-3 sm:px-6">
            <div className="flex items-center gap-2">
              {wizardSteps.map((step, index) => {
                const isActive = index === currentStepIndex;
                const isCompleted = index < currentStepIndex;
                return (
                  <div key={step} className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                        isCompleted
                          ? "bg-emerald-500 text-white"
                          : isActive
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {index + 1}
                    </div>
                    <span
                      className={cn(
                        "hidden truncate text-xs font-medium sm:block",
                        isActive ? "text-slate-900" : "text-slate-500",
                      )}
                    >
                      {STEP_LABELS[step]}
                    </span>
                    {index < wizardSteps.length - 1 ? (
                      <div
                        className={cn(
                          "mx-1 hidden h-px flex-1 sm:block",
                          isCompleted ? "bg-emerald-300" : "bg-slate-200",
                        )}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {renderStepContent()}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
            {!isFirstStep ? (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-slate-200"
                onClick={goBack}
                disabled={saving}
              >
                Atrás
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-slate-200"
                onClick={requestClose}
                disabled={saving}
              >
                Cancelar
              </Button>
            )}

            {isSummaryStep ? (
              <Button
                type="button"
                className="rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-700"
                onClick={handleConfirmSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : isEditing ? (
                  "Confirmar y guardar"
                ) : (
                  "Confirmar y crear"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-600/25 hover:bg-indigo-700"
                onClick={goNext}
                disabled={saving}
              >
                Continuar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle>¿Descartar cambios?</DialogTitle>
            <DialogDescription>
              Hay cambios sin guardar en este usuario. Si cierras ahora, se
              perderán.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => setDiscardOpen(false)}
            >
              Seguir editando
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setDiscardOpen(false);
                onClose();
              }}
            >
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
