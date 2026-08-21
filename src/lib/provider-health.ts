import type { ProviderName } from "./lord-config";

export type HealthStatus =
  | "healthy"
  | "unavailable"
  | "rate_limited"
  | "invalid"
  | "missing_api_key"
  | "unknown"
  // Image-pipeline statuses. They stay distinct from `invalid`/`unavailable` so
  // the operator (and the UI) can tell "add credits" apart from "bad key",
  // "model does not support this", and "provider was too slow".
  | "quota"
  | "auth_failed"
  | "timeout"
  | "unsupported";

/** Operator-facing label for a cached health status. */
export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: "Healthy",
  unavailable: "Unavailable",
  rate_limited: "Rate Limited",
  invalid: "Invalid",
  missing_api_key: "Missing API key",
  unknown: "Unknown",
  quota: "Quota",
  auth_failed: "Auth Failed",
  timeout: "Timeout",
  unsupported: "Unsupported",
};

export interface HealthCacheEntry {
  provider: ProviderName;
  model: string;
  status: HealthStatus;
  reason: string;
  timestamp: number;
  expiresAt: number;
  httpStatus?: number;
  retryable?: boolean;
}

export interface HealthCache {
  get(provider: ProviderName, model: string): HealthCacheEntry | undefined;
  set(entry: HealthCacheEntry): void;
  clear(): void;
  clearProvider(provider: ProviderName): void;
  clearModel(provider: ProviderName, model: string): void;
  getAll(): HealthCacheEntry[];
  isHealthy(provider: ProviderName, model: string): boolean;
  getDisabledModels(): HealthCacheEntry[];
  getTtlForStatus(status: number | "timeout" | "network" | "unknown"): number;
}

export function createHealthCache(config: {
  defaultTtlMs: number;
  ttlByStatus: Record<string, number>;
}): HealthCache {
  const cache = new Map<string, HealthCacheEntry>();

  function key(provider: ProviderName, model: string): string {
    return `${provider}:${model}`;
  }

  function pruneExpired(): void {
    const now = Date.now();
    for (const [k, entry] of cache) {
      if (now >= entry.expiresAt) {
        cache.delete(k);
      }
    }
  }

  return {
    get(provider, model) {
      pruneExpired();
      return cache.get(key(provider, model));
    },

    set(entry) {
      cache.set(key(entry.provider, entry.model), entry);
    },

    clear() {
      cache.clear();
    },

    clearProvider(provider) {
      for (const k of cache.keys()) {
        if (k.startsWith(`${provider}:`)) {
          cache.delete(k);
        }
      }
    },

    clearModel(provider, model) {
      cache.delete(key(provider, model));
    },

    getAll() {
      pruneExpired();
      return Array.from(cache.values());
    },

    isHealthy(provider, model) {
      const entry = this.get(provider, model);
      if (!entry) return true;
      return entry.status === "healthy";
    },

    getDisabledModels() {
      pruneExpired();
      return Array.from(cache.values()).filter((e) => e.status !== "healthy");
    },

    getTtlForStatus(status) {
      const key = typeof status === "number" ? String(status) : status;
      return config.ttlByStatus[key] ?? config.defaultTtlMs;
    },
  };
}

export type { ProviderName };
