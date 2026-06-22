import type { AbcdConfig, RotationRow } from "./rotacion-preamble";

/** Alineado con ROTATION_SUCCESS_CACHE_CONTROL del API (5 min). */
export const ROTACION_FRONT_ROWS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Limite bajo: cada entrada puede pesar ~10–20 MB serializada. */
const MAX_CACHE_ENTRIES = 6;

const DB_NAME = "visor-rotacion";
const STORE_NAME = "rows-cache";
const DB_VERSION = 1;

type RotacionRowsIdbRecord = {
  key: string;
  rows: RotationRow[];
  abcdConfig?: AbcdConfig;
  cachedAt: number;
  expiresAt: number;
};

export type RotacionRowsIdbCacheValue = {
  rows: RotationRow[];
  abcdConfig?: AbcdConfig;
};

export const buildRotacionRowsCacheKey = (
  apiBasePath: string,
  userId: string | null | undefined,
  rowsFilterKey: string,
): string => {
  const userScope = userId?.trim() || "anon";
  return `${apiBasePath}|${userScope}|${rowsFilterKey}`;
};

const isIndexedDbAvailable = (): boolean =>
  typeof indexedDB !== "undefined";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("IndexedDB no disponible"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(request.error ?? new Error("No se pudo abrir IndexedDB"));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
  });

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
  readResult?: (tx: IDBTransaction) => T,
): Promise<T | void> => {
  const db = await openDb();
  try {
    return await new Promise<T | void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      run(store);
      tx.oncomplete = () => {
        resolve(readResult ? readResult(tx) : undefined);
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error("Transaccion IndexedDB fallida"));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error("Transaccion IndexedDB abortada"));
      };
    });
  } finally {
    db.close();
  }
};

const getRecord = async (
  key: string,
): Promise<RotacionRowsIdbRecord | undefined> => {
  let result: RotacionRowsIdbRecord | undefined;
  await runTransaction("readonly", (store) => {
    const request = store.get(key);
    request.onsuccess = () => {
      result = request.result as RotacionRowsIdbRecord | undefined;
    };
    request.onerror = () => {
      throw request.error ?? new Error("Lectura IndexedDB fallida");
    };
  });
  return result;
};

const listRecords = async (): Promise<RotacionRowsIdbRecord[]> => {
  let result: RotacionRowsIdbRecord[] = [];
  await runTransaction("readonly", (store) => {
    const request = store.getAll();
    request.onsuccess = () => {
      result = (request.result as RotacionRowsIdbRecord[]) ?? [];
    };
    request.onerror = () => {
      throw request.error ?? new Error("Listado IndexedDB fallido");
    };
  });
  return result;
};

const putRecord = async (record: RotacionRowsIdbRecord): Promise<void> => {
  await runTransaction("readwrite", (store) => {
    store.put(record);
  });
};

const deleteRecord = async (key: string): Promise<void> => {
  await runTransaction("readwrite", (store) => {
    store.delete(key);
  });
};

const pruneExpired = async (): Promise<void> => {
  const now = Date.now();
  const records = await listRecords();
  await Promise.all(
    records
      .filter((record) => record.expiresAt <= now)
      .map((record) => deleteRecord(record.key)),
  );
};

const enforceMaxEntries = async (): Promise<void> => {
  const records = await listRecords();
  if (records.length <= MAX_CACHE_ENTRIES) return;

  const sorted = [...records].sort((a, b) => a.cachedAt - b.cachedAt);
  const toRemove = sorted.slice(0, records.length - MAX_CACHE_ENTRIES);
  await Promise.all(toRemove.map((record) => deleteRecord(record.key)));
};

export const readRotacionRowsIdbCache = async (
  key: string,
): Promise<RotacionRowsIdbCacheValue | null> => {
  if (!isIndexedDbAvailable()) return null;

  try {
    const record = await getRecord(key);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      await deleteRecord(key);
      return null;
    }
    return {
      rows: record.rows,
      abcdConfig: record.abcdConfig,
    };
  } catch (err) {
    console.warn(
      "[rotacion] Cache IDB lectura fallida:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
};

export const writeRotacionRowsIdbCache = async (
  key: string,
  value: RotacionRowsIdbCacheValue,
): Promise<boolean> => {
  if (!isIndexedDbAvailable()) return false;

  const record: RotacionRowsIdbRecord = {
    key,
    rows: value.rows,
    abcdConfig: value.abcdConfig,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ROTACION_FRONT_ROWS_CACHE_TTL_MS,
  };

  const persist = async () => {
    await pruneExpired();
    await putRecord(record);
    await enforceMaxEntries();
  };

  try {
    await persist();
    console.info(
      `[rotacion] Cache IDB guardado (${value.rows.length} filas, TTL 5 min).`,
    );
    return true;
  } catch (err) {
    const isQuota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.code === 22);
    if (!isQuota) {
      console.warn(
        "[rotacion] Cache IDB escritura fallida:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }

    try {
      const records = await listRecords();
      const sorted = [...records].sort((a, b) => a.cachedAt - b.cachedAt);
      if (sorted.length > 0) {
        await deleteRecord(sorted[0].key);
      }
      await persist();
      console.info(
        `[rotacion] Cache IDB guardado tras eviccion (${value.rows.length} filas).`,
      );
      return true;
    } catch (retryErr) {
      console.warn(
        "[rotacion] Cache IDB escritura fallida tras eviccion:",
        retryErr instanceof Error ? retryErr.message : String(retryErr),
      );
      return false;
    }
  }
};
