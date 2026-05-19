import { AsyncLocalStorage } from "node:async_hooks";
import {
  ROTACION_SOURCE_LEGACY,
  type RotacionSourceTable,
} from "@/lib/rotacion/source-tables";

type RotacionSourceContext = {
  sourceTable: RotacionSourceTable;
};

const storage = new AsyncLocalStorage<RotacionSourceContext>();

export function getRotacionSourceTable(): RotacionSourceTable {
  return storage.getStore()?.sourceTable ?? ROTACION_SOURCE_LEGACY;
}

export function runWithRotacionSourceTable<T>(
  sourceTable: RotacionSourceTable,
  fn: () => T,
): T {
  return storage.run({ sourceTable }, fn);
}

export async function runWithRotacionSourceTableAsync<T>(
  sourceTable: RotacionSourceTable,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ sourceTable }, fn);
}
