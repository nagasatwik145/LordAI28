// Automatic recovery (Phase 7).
//
// When a cooldown expires the provider is NOT immediately trusted with user
// traffic. Instead a single lightweight health check is sent:
//
//   success -> the provider is marked healthy again
//   failure -> the cooldown is extended (with circuit-breaker escalation)
//
// Two guarantees matter here:
//   * single-flight — only one probe per provider can be in flight, so a
//     recovering provider is never stampeded;
//   * off the hot path — recovery runs in the background (or is explicitly
//     awaited by the admin dashboard), so it never adds latency to a user
//     request. Live traffic uses the half-open path in the router instead.

import type { ProviderHealthManager } from "./provider-health-manager";
import type { ProviderFailure, ProviderId } from "./provider-types";
import { PROVIDER_IDS } from "./provider-types";

export interface ProviderProbeResult {
  ok: boolean;
  latencyMs: number;
  failure?: ProviderFailure;
}

/** A cheap "are you alive?" call. Must be fast and must not stream. */
export type ProviderProbe = (provider: ProviderId) => Promise<ProviderProbeResult>;

export interface ProviderRecoveryLogger {
  info?(event: string, payload: Record<string, unknown>): void;
  warn?(event: string, payload: Record<string, unknown>): void;
  error?(event: string, payload: Record<string, unknown>): void;
}

export interface ProviderRecoveryOptions {
  manager: ProviderHealthManager;
  probe: ProviderProbe;
  logger?: ProviderRecoveryLogger;
  now?: () => number;
  /** Interval for the optional background sweep. */
  sweepIntervalMs?: number;
}

export interface ProviderRecoveryService {
  /**
   * Probe one provider. Returns `null` when the probe was skipped (provider is
   * still cooling down, unconfigured, credential-held, or already being probed).
   */
  recover(provider: ProviderId): Promise<ProviderProbeResult | null>;
  /** Probe every provider whose cooldown has expired. */
  recoverExpired(): Promise<Array<{ provider: ProviderId; result: ProviderProbeResult | null }>>;
  /** Start the background sweep. Safe to call twice. */
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export const DEFAULT_RECOVERY_SWEEP_INTERVAL_MS = 60_000;

export function createProviderRecoveryService(
  options: ProviderRecoveryOptions,
): ProviderRecoveryService {
  const { manager, probe, logger } = options;
  const now = options.now ?? Date.now;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_RECOVERY_SWEEP_INTERVAL_MS;
  const inFlight = new Map<ProviderId, Promise<ProviderProbeResult | null>>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runProbe(provider: ProviderId): Promise<ProviderProbeResult | null> {
    // Single-flight: a provider is probed once, no matter how many callers ask.
    const existing = inFlight.get(provider);
    if (existing) return existing;

    const health = manager.get(provider);
    if (!health.configured) return null;
    if (health.disabledUntilConfigChange) return null;
    if (manager.isInCooldown(provider)) return null;
    if (!manager.acquireProbeSlot(provider)) return null;

    const started = now();
    const task = (async (): Promise<ProviderProbeResult | null> => {
      try {
        const result = await probe(provider);
        const latencyMs = result.latencyMs > 0 ? result.latencyMs : Math.max(1, now() - started);
        if (result.ok) {
          manager.recordRecoverySuccess(provider, latencyMs);
          logger?.info?.("provider_recovery_success", { provider, latencyMs });
          return { ...result, latencyMs };
        }
        const failure: ProviderFailure = result.failure ?? {
          kind: "unknown",
          message: "Health check failed without a classified error",
        };
        const decision = manager.recordRecoveryFailure(provider, { ...failure, latencyMs });
        logger?.warn?.("provider_recovery_extended_cooldown", {
          provider,
          kind: failure.kind,
          cooldownMs: decision.cooldownMs,
          cooldownUntil: decision.cooldownUntil,
        });
        return { ...result, latencyMs };
      } catch (error) {
        const failure: ProviderFailure = {
          kind: "unknown",
          message: error instanceof Error ? error.message : String(error),
        };
        const decision = manager.recordRecoveryFailure(provider, failure);
        logger?.error?.("provider_recovery_threw", {
          provider,
          message: failure.message,
          cooldownUntil: decision.cooldownUntil,
        });
        return { ok: false, latencyMs: Math.max(1, now() - started), failure };
      } finally {
        manager.releaseProbeSlot(provider);
        inFlight.delete(provider);
      }
    })();

    inFlight.set(provider, task);
    return task;
  }

  const service: ProviderRecoveryService = {
    get running() {
      return timer !== null;
    },

    recover(provider) {
      return runProbe(provider);
    },

    async recoverExpired() {
      const candidates = manager.getProvidersAwaitingRecovery();
      if (candidates.length === 0) return [];
      // Providers are independent — probe them in parallel (Phase 10).
      const results = await Promise.all(
        candidates.map(async (provider) => ({
          provider,
          result: await runProbe(provider),
        })),
      );
      return results;
    },

    start() {
      if (timer) return;
      timer = setInterval(() => {
        void service.recoverExpired().catch(() => {
          // Recovery is best-effort; a failed sweep must never crash the server.
        });
      }, sweepIntervalMs);
      // Never hold the process open just for the recovery sweep.
      (timer as unknown as { unref?: () => void }).unref?.();
      logger?.info?.("provider_recovery_started", { sweepIntervalMs });
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      logger?.info?.("provider_recovery_stopped", {});
    },
  };

  return service;
}

/** Convenience: providers that currently need attention, for logs/dashboards. */
export function summarizeRecoveryQueue(manager: ProviderHealthManager) {
  return PROVIDER_IDS.map((provider) => {
    const health = manager.get(provider);
    return {
      provider,
      status: health.status,
      cooldownRemainingMs: health.cooldownRemainingMs,
      awaitingRecovery: health.circuitState === "half_open",
    };
  }).filter((entry) => entry.cooldownRemainingMs > 0 || entry.awaitingRecovery);
}
