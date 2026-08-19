"use client";

import { createContext, useContext } from "react";
import type { ChecklistActorRole } from "@/lib/checklists/session";
import type { ChecklistSnapshot } from "@/lib/checklists/snapshot";

type ChecklistRunContextValue = {
  actorRole: ChecklistActorRole | null;
  priorSnapshot: ChecklistSnapshot | null;
  saveSnapshot: (snapshot: ChecklistSnapshot) => void;
};

const ChecklistRunContext = createContext<ChecklistRunContextValue | null>(null);

export function ChecklistRunProvider({
  value,
  children,
}: {
  value: ChecklistRunContextValue;
  children: React.ReactNode;
}) {
  return (
    <ChecklistRunContext.Provider value={value}>
      {children}
    </ChecklistRunContext.Provider>
  );
}

export function useChecklistRunContext() {
  return useContext(ChecklistRunContext);
}
