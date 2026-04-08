import { getClientIp } from "@/lib/auth";

type RateLimitOptions = {
  windowMs: number;
  max: number;
  maxEntries?: number;
  keyPrefix?: string;
};

type RateLimitEntry = { count: number; resetAt: number };

const DEFAULT_MAX_ENTRIES = 5000;
const rateLimitStore = new Map<string, RateLimitEntry>();

const cleanupRateLimitStore = (now: number, maxEntries: number) => {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
  if (rateLimitStore.size <= maxEntries) return;
  const overflow = rateLimitStore.size - maxEntries;
  const keys = rateLimitStore.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = keys.next();
    if (next.done) break;
    rateLimitStore.delete(next.value);
  }
};

export const checkRateLimit = (request: Request, options: RateLimitOptions) => {
  const now = Date.now();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  cleanupRateLimitStore(now, maxEntries);

  const rawIp = getClientIp(request) ?? "unknown";
  const keyPrefix = options.keyPrefix ?? "default";
  const storeKey = `${keyPrefix}:${rawIp}`;

  const entry = rateLimitStore.get(storeKey);
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(storeKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }
  if (entry.count >= options.max) {
    return entry.resetAt;
  }
  entry.count += 1;
  return null;
};
