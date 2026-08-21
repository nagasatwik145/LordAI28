// Image provider health: a single cached probe of Cloudflare credentials,
// connectivity, and per-model availability. Request paths read the cache; the
// server start-up path refreshes it so a missing token or unreachable account
// is reported once at boot instead of surfacing as a confusing per-request 503.

import { cloudflareImageProvider } from "./cloudflare-provider";
import { createStructuredLogger } from "../shared/structured-logger";
import type { ImageProviderHealth } from "./image-types";

const HEALTH_TTL_MS = 60_000;

let cached: ImageProviderHealth | null = null;
let cachedAt = 0;

const log = createStructuredLogger("image:health");

/** Last cached health, or `null` before the first probe. */
export function getCachedImageHealth(): ImageProviderHealth | null {
  return cached;
}

/** Refresh (or read) the cached Cloudflare health. */
export async function checkImageHealth(force = false): Promise<ImageProviderHealth> {
  if (!force && cached && Date.now() - cachedAt < HEALTH_TTL_MS) return cached;
  cached = await cloudflareImageProvider.healthCheck();
  cachedAt = Date.now();
  return cached;
}

/**
 * Startup health check. Logs a concise, operator-actionable summary and returns
 * the health object so the caller can decide whether to warn more loudly.
 */
export async function ensureImageHealth(): Promise<ImageProviderHealth> {
  const health = await checkImageHealth(true);
  if (health.healthy) {
    const healthyModels = health.models.filter((m) => m.healthy).map((m) => m.model);
    log.info("startup_healthy", {
      configuredModel: health.configuredModel,
      healthyModels,
      latencyMs: health.latencyMs,
    });
  } else {
    log.warn("startup_unhealthy", {
      status: health.status,
      reason: health.reason,
      missingEnv: health.missingEnv,
      configuredModel: health.configuredModel,
    });
  }
  return health;
}
