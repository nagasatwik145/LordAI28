// ProviderHealthManager — the single source of truth for provider health.
//
// Everything that talks to an AI provider reads this before making a request
// and writes to it after. It owns:
//
//   Phase 1  the `ProviderHealth` record for every provider
//   Phase 2  smart cooldowns derived from the failure kind
//   Phase 4  the circuit breaker (5 consecutive failures -> open -> half-open)
//   Phase 6  the in-memory health cache: a provider in cooldown is skipped
//            immediately, with zero network calls
//   Phase 7  the bookkeeping the recovery service needs (probe single-flight,
//            cooldown extension when a recovery probe fails)
//
// The manager is intentionally synchronous and side-effect free apart from its
// own state: it never performs I/O, which makes it trivial to unit test and
// impossible for it to add latency to a request.

import {
  CIRCUIT_FAILURE_THRESHOLD,
  isConfigurationHoldFailure,
  isProviderScopedFailure,
  resolveCooldownMs,
} from "./provider-policy";
import {
  FAILURE_KIND_LABELS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type ProviderCircuitState,
  type ProviderFailure,
  type ProviderFailureKind,
  type ProviderHealth,
  type ProviderHealthStatus,
  type ProviderId,
  type ProviderQuota,
  type ProviderSkip,
} from "./provider-types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProviderHealthManagerConfig {
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** How many latency samples the rolling average keeps. */
  latencySamples: number;
  /**
   * Latency assumed for a provider that has never answered. Providers measured
   * faster than this win; providers measured slower lose. Prevents an unproven
   * provider from displacing a proven-fast one, and vice versa.
   */
  assumedLatencyMs: number;
  /** How long a half-open trial may be in flight before the slot is released. */
  halfOpenTrialTimeoutMs: number;
}

export const DEFAULT_PROVIDER_HEALTH_CONFIG: ProviderHealthManagerConfig = {
  failureThreshold: CIRCUIT_FAILURE_THRESHOLD,
  latencySamples: 20,
  assumedLatencyMs: 1_500,
  halfOpenTrialTimeoutMs: 30_000,
};

export interface ProviderHealthLogger {
  debug?(event: string, payload: Record<string, unknown>): void;
  info?(event: string, payload: Record<string, unknown>): void;
  warn?(event: string, payload: Record<string, unknown>): void;
  error?(event: string, payload: Record<string, unknown>): void;
}

export interface ProviderHealthManagerOptions {
  now?: () => number;
  random?: () => number;
  config?: Partial<ProviderHealthManagerConfig>;
  logger?: ProviderHealthLogger;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface ProviderState {
  id: ProviderId;
  configured: boolean;
  configurationIssue: string | null;

  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;

  lastSuccessAt: number | null;
  lastFailureAt: number | null;

  cooldownUntil: number | null;
  cooldownReason: string | null;
  cooldownKind: ProviderFailureKind | null;
  /** Times the circuit has opened; escalates the cooldown on each trip. */
  circuitOpenCount: number;
  circuitTripped: boolean;
  /** Epoch ms when the current half-open trial started, if any. */
  halfOpenTrialAt: number | null;

  disabledUntilConfigChange: boolean;

  latency: number[];
  averageLatencyMs: number;

  lastFailureKind: ProviderFailureKind | null;
  lastFailureStatus: number | null;
  lastFailureMessage: string | null;

  currentModel: string | null;
  quota: ProviderQuota | null;

  dayKey: string;
  requestsToday: number;

  lastProbeAt: number | null;
}

export interface RecordFailureResult {
  provider: ProviderId;
  kind: ProviderFailureKind;
  /** Cooldown applied by this failure (0 when the provider was not penalized). */
  cooldownMs: number;
  cooldownUntil: number | null;
  circuitState: ProviderCircuitState;
  /** True when this failure opened (or re-opened) the circuit. */
  circuitOpened: boolean;
  /** True when the provider is now unusable until an operator acts. */
  disabledUntilConfigChange: boolean;
  consecutiveFailures: number;
}

export interface ProviderHealthManager {
  /** Snapshot for one provider. */
  get(provider: ProviderId): ProviderHealth;
  /** Snapshot for every known provider, in canonical order. */
  getAll(): ProviderHealth[];
  /** Snapshot for the given providers, in canonical order. */
  getMany(providers: readonly ProviderId[]): ProviderHealth[];

  /** True when the provider may be contacted right now. */
  isAvailable(provider: ProviderId): boolean;
  /** True when the provider is inside an active cooldown window. */
  isInCooldown(provider: ProviderId): boolean;
  /** Non-null when the provider must be skipped, explaining exactly why. */
  getSkip(provider: ProviderId): ProviderSkip | null;
  /** Milliseconds left on the cooldown; 0 when not cooling down. */
  getCooldownRemainingMs(provider: ProviderId): number;
  circuitState(provider: ProviderId): ProviderCircuitState;

  /** Declare whether the provider has usable credentials. */
  setConfigured(provider: ProviderId, configured: boolean, issue?: string | null): void;
  /** Clear an auth hold, e.g. after the operator reloaded the environment. */
  clearConfigurationHold(provider?: ProviderId): void;

  recordSuccess(
    provider: ProviderId,
    info?: { latencyMs?: number; model?: string; quota?: ProviderQuota | null },
  ): void;
  recordFailure(provider: ProviderId, failure: ProviderFailure): RecordFailureResult;

  /** Reserve the single half-open probe slot. Returns false when taken. */
  acquireProbeSlot(provider: ProviderId): boolean;
  releaseProbeSlot(provider: ProviderId): void;
  /** Providers whose cooldown has expired and that need a recovery probe. */
  getProvidersAwaitingRecovery(): ProviderId[];
  /** A recovery probe succeeded: the provider is healthy again. */
  recordRecoverySuccess(provider: ProviderId, latencyMs?: number): void;
  /** A recovery probe failed: extend the cooldown instead of admitting traffic. */
  recordRecoveryFailure(provider: ProviderId, failure: ProviderFailure): RecordFailureResult;

  /** Latency used for ranking; falls back to the configured assumption. */
  effectiveLatencyMs(provider: ProviderId): number;

  reset(provider?: ProviderId): void;
  readonly config: ProviderHealthManagerConfig;
}

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProviderHealthManager(
  options: ProviderHealthManagerOptions = {},
): ProviderHealthManager {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const logger = options.logger;
  const config: ProviderHealthManagerConfig = {
    ...DEFAULT_PROVIDER_HEALTH_CONFIG,
    ...options.config,
  };

  const states = new Map<ProviderId, ProviderState>();

  function blank(id: ProviderId): ProviderState {
    return {
      id,
      configured: false,
      configurationIssue: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalRequests: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      cooldownUntil: null,
      cooldownReason: null,
      cooldownKind: null,
      circuitOpenCount: 0,
      circuitTripped: false,
      halfOpenTrialAt: null,
      disabledUntilConfigChange: false,
      latency: [],
      averageLatencyMs: 0,
      lastFailureKind: null,
      lastFailureStatus: null,
      lastFailureMessage: null,
      currentModel: null,
      quota: null,
      dayKey: utcDayKey(now()),
      requestsToday: 0,
      lastProbeAt: null,
    };
  }

  function state(id: ProviderId): ProviderState {
    let entry = states.get(id);
    if (!entry) {
      entry = blank(id);
      states.set(id, entry);
    }
    rollDay(entry);
    return entry;
  }

  function rollDay(entry: ProviderState): void {
    const key = utcDayKey(now());
    if (entry.dayKey !== key) {
      entry.dayKey = key;
      entry.requestsToday = 0;
    }
  }

  function cooldownActive(entry: ProviderState): boolean {
    return entry.cooldownUntil !== null && now() < entry.cooldownUntil;
  }

  function trialInFlight(entry: ProviderState): boolean {
    if (entry.halfOpenTrialAt === null) return false;
    if (now() - entry.halfOpenTrialAt >= config.halfOpenTrialTimeoutMs) {
      entry.halfOpenTrialAt = null;
      return false;
    }
    return true;
  }

  function circuitStateOf(entry: ProviderState): ProviderCircuitState {
    if (entry.disabledUntilConfigChange) return "open";
    if (cooldownActive(entry)) return "open";
    // Cooldown expired but the provider has not proven itself yet: the next
    // request is a trial (Phase 4 "half open").
    if (entry.consecutiveFailures > 0) return "half_open";
    return "closed";
  }

  function statusOf(entry: ProviderState): ProviderHealthStatus {
    if (!entry.configured) return "offline";
    if (entry.disabledUntilConfigChange) return "offline";
    if (cooldownActive(entry)) {
      return entry.cooldownKind === "rate_limit" || entry.cooldownKind === "quota_exceeded"
        ? "rate_limited"
        : "offline";
    }
    if (entry.consecutiveFailures > 0) return "degraded";
    return "healthy";
  }

  function snapshot(entry: ProviderState): ProviderHealth {
    const cooldownRemainingMs = cooldownActive(entry)
      ? Math.max(0, (entry.cooldownUntil as number) - now())
      : 0;
    const successRate = entry.totalRequests > 0 ? entry.totalSuccesses / entry.totalRequests : 1;

    return {
      provider: PROVIDER_LABELS[entry.id],
      status: statusOf(entry),
      lastSuccess: entry.lastSuccessAt === null ? null : new Date(entry.lastSuccessAt),
      lastFailure: entry.lastFailureAt === null ? null : new Date(entry.lastFailureAt),
      failureCount: entry.consecutiveFailures,
      ...(cooldownActive(entry) && entry.cooldownUntil !== null
        ? { cooldownUntil: new Date(entry.cooldownUntil) }
        : {}),
      averageLatencyMs: Math.round(entry.averageLatencyMs),

      providerId: entry.id,
      configured: entry.configured,
      configurationIssue: entry.configurationIssue,
      circuitState: circuitStateOf(entry),
      disabledUntilConfigChange: entry.disabledUntilConfigChange,
      consecutiveSuccesses: entry.consecutiveSuccesses,
      totalRequests: entry.totalRequests,
      totalSuccesses: entry.totalSuccesses,
      totalFailures: entry.totalFailures,
      requestsToday: entry.requestsToday,
      successRate,
      cooldownRemainingMs,
      cooldownReason: cooldownActive(entry) ? entry.cooldownReason : null,
      lastFailureKind: entry.lastFailureKind,
      lastFailureStatus: entry.lastFailureStatus,
      lastFailureMessage: entry.lastFailureMessage,
      currentModel: entry.currentModel,
      quota: entry.quota,
      lastProbeAt: entry.lastProbeAt,
    };
  }

  function applyLatency(entry: ProviderState, latencyMs: number | undefined): void {
    if (typeof latencyMs !== "number" || !Number.isFinite(latencyMs) || latencyMs <= 0) return;
    entry.latency.push(latencyMs);
    if (entry.latency.length > config.latencySamples) {
      entry.latency = entry.latency.slice(-config.latencySamples);
    }
    const total = entry.latency.reduce((sum, value) => sum + value, 0);
    entry.averageLatencyMs = total / entry.latency.length;
  }

  function openCircuit(entry: ProviderState, kind: ProviderFailureKind, cooldownMs: number): void {
    entry.cooldownUntil = now() + cooldownMs;
    entry.cooldownKind = kind;
    entry.cooldownReason = FAILURE_KIND_LABELS[kind];
    entry.halfOpenTrialAt = null;
  }

  function failureCore(
    provider: ProviderId,
    failure: ProviderFailure,
    fromRecoveryProbe: boolean,
  ): RecordFailureResult {
    const entry = state(provider);
    const kind = failure.kind;
    const wasHalfOpen = circuitStateOf(entry) === "half_open";

    entry.lastFailureKind = kind;
    entry.lastFailureStatus = failure.status ?? null;
    entry.lastFailureMessage = failure.message ?? null;
    if (failure.model) entry.currentModel = failure.model;
    if (failure.quota) entry.quota = failure.quota;
    applyLatency(entry, failure.latencyMs);

    // An abort is the caller's decision, never the provider's fault.
    if (kind === "aborted") {
      logger?.debug?.("provider_failure_ignored", { provider, kind });
      return {
        provider,
        kind,
        cooldownMs: 0,
        cooldownUntil: entry.cooldownUntil,
        circuitState: circuitStateOf(entry),
        circuitOpened: false,
        disabledUntilConfigChange: entry.disabledUntilConfigChange,
        consecutiveFailures: entry.consecutiveFailures,
      };
    }

    entry.lastFailureAt = now();
    entry.totalFailures += 1;
    entry.totalRequests += 1;
    entry.requestsToday += 1;
    entry.consecutiveSuccesses = 0;
    entry.halfOpenTrialAt = null;

    // A bad payload or a dead model is not a provider outage: do not penalize
    // the provider, so the remaining models stay routable.
    if (!isProviderScopedFailure(kind)) {
      logger?.info?.("provider_failure_scoped", {
        provider,
        kind,
        status: failure.status,
        model: failure.model,
        detail: "failure is scoped to the request/model; provider not penalized",
      });
      return {
        provider,
        kind,
        cooldownMs: 0,
        cooldownUntil: entry.cooldownUntil,
        circuitState: circuitStateOf(entry),
        circuitOpened: false,
        disabledUntilConfigChange: entry.disabledUntilConfigChange,
        consecutiveFailures: entry.consecutiveFailures,
      };
    }

    entry.consecutiveFailures += 1;

    // 401 / 403: the credentials themselves were rejected. No timer can fix
    // that, so the provider is held until the configuration changes.
    if (isConfigurationHoldFailure(kind)) {
      entry.disabledUntilConfigChange = true;
      entry.cooldownUntil = null;
      entry.cooldownKind = kind;
      entry.cooldownReason = FAILURE_KIND_LABELS[kind];
      entry.circuitTripped = true;
      logger?.error?.("provider_disabled_until_config_change", {
        provider,
        status: failure.status,
        message: failure.message,
      });
      return {
        provider,
        kind,
        cooldownMs: 0,
        cooldownUntil: null,
        circuitState: "open",
        circuitOpened: true,
        disabledUntilConfigChange: true,
        consecutiveFailures: entry.consecutiveFailures,
      };
    }

    // Circuit breaker: N consecutive failures, or any failure while half-open,
    // trips the breaker and escalates the cooldown.
    const trips =
      entry.consecutiveFailures >= config.failureThreshold ||
      wasHalfOpen ||
      fromRecoveryProbe ||
      entry.circuitTripped;

    // Respect an advertised Retry-After, and otherwise a quota reset window.
    const quotaResetMs =
      failure.quota?.resetAt != null ? Math.max(0, failure.quota.resetAt - now()) : undefined;
    const retryAfterMs = failure.retryAfterMs ?? quotaResetMs;

    const cooldownMs = resolveCooldownMs({
      kind,
      retryAfterMs,
      circuitOpenCount: entry.circuitOpenCount,
      circuitTripped: trips,
      random,
    });

    const circuitOpened = trips && !entry.circuitTripped;
    if (trips) {
      entry.circuitTripped = true;
      entry.circuitOpenCount += 1;
    }

    if (cooldownMs > 0) openCircuit(entry, kind, cooldownMs);

    logger?.warn?.("provider_cooldown_applied", {
      provider,
      kind,
      status: failure.status,
      cooldownMs,
      cooldownUntil: entry.cooldownUntil,
      consecutiveFailures: entry.consecutiveFailures,
      circuitState: circuitStateOf(entry),
      fromRecoveryProbe,
    });

    return {
      provider,
      kind,
      cooldownMs,
      cooldownUntil: entry.cooldownUntil,
      circuitState: circuitStateOf(entry),
      circuitOpened,
      disabledUntilConfigChange: entry.disabledUntilConfigChange,
      consecutiveFailures: entry.consecutiveFailures,
    };
  }

  const manager: ProviderHealthManager = {
    config,

    get(provider) {
      return snapshot(state(provider));
    },

    getAll() {
      return PROVIDER_IDS.map((id) => snapshot(state(id)));
    },

    getMany(providers) {
      const wanted = new Set(providers);
      return PROVIDER_IDS.filter((id) => wanted.has(id)).map((id) => snapshot(state(id)));
    },

    isAvailable(provider) {
      const entry = state(provider);
      if (!entry.configured) return false;
      if (entry.disabledUntilConfigChange) return false;
      if (cooldownActive(entry)) return false;
      return true;
    },

    isInCooldown(provider) {
      return cooldownActive(state(provider));
    },

    getSkip(provider) {
      const entry = state(provider);
      if (!entry.configured) {
        return {
          provider,
          code: "not_configured",
          detail: entry.configurationIssue ?? "No API key configured",
        };
      }
      if (entry.disabledUntilConfigChange) {
        return {
          provider,
          code: "disabled",
          detail:
            entry.lastFailureMessage ??
            "Credentials were rejected; disabled until the configuration changes",
          kind: entry.lastFailureKind ?? "auth",
        };
      }
      if (cooldownActive(entry)) {
        const retryAt = entry.cooldownUntil as number;
        return {
          provider,
          code: "cooldown",
          detail: entry.cooldownReason ?? "In cooldown",
          retryAt,
          remainingMs: Math.max(0, retryAt - now()),
          kind: entry.cooldownKind ?? undefined,
        };
      }
      return null;
    },

    getCooldownRemainingMs(provider) {
      const entry = state(provider);
      if (!cooldownActive(entry)) return 0;
      return Math.max(0, (entry.cooldownUntil as number) - now());
    },

    circuitState(provider) {
      return circuitStateOf(state(provider));
    },

    setConfigured(provider, configured, issue = null) {
      const entry = state(provider);
      const changed = entry.configured !== configured || entry.configurationIssue !== issue;
      entry.configured = configured;
      entry.configurationIssue = configured ? null : (issue ?? "No API key configured");
      // A configuration change is exactly the event that clears an auth hold.
      if (changed && configured && entry.disabledUntilConfigChange) {
        entry.disabledUntilConfigChange = false;
        entry.consecutiveFailures = 0;
        entry.circuitTripped = false;
        entry.cooldownUntil = null;
        entry.cooldownReason = null;
        entry.cooldownKind = null;
        logger?.info?.("provider_config_hold_cleared", { provider });
      }
    },

    clearConfigurationHold(provider) {
      const targets = provider ? [provider] : [...PROVIDER_IDS];
      for (const id of targets) {
        const entry = state(id);
        if (!entry.disabledUntilConfigChange) continue;
        entry.disabledUntilConfigChange = false;
        entry.consecutiveFailures = 0;
        entry.circuitTripped = false;
        entry.circuitOpenCount = 0;
        entry.cooldownUntil = null;
        entry.cooldownReason = null;
        entry.cooldownKind = null;
        logger?.info?.("provider_config_hold_cleared", { provider: id });
      }
    },

    recordSuccess(provider, info) {
      const entry = state(provider);
      entry.lastSuccessAt = now();
      entry.totalSuccesses += 1;
      entry.totalRequests += 1;
      entry.requestsToday += 1;
      entry.consecutiveSuccesses += 1;
      entry.consecutiveFailures = 0;
      entry.cooldownUntil = null;
      entry.cooldownReason = null;
      entry.cooldownKind = null;
      entry.circuitTripped = false;
      entry.circuitOpenCount = 0;
      entry.halfOpenTrialAt = null;
      // A success proves the credentials work.
      entry.disabledUntilConfigChange = false;
      if (info?.model) entry.currentModel = info.model;
      if (info?.quota !== undefined) entry.quota = info.quota;
      applyLatency(entry, info?.latencyMs);
      logger?.debug?.("provider_success", {
        provider,
        model: info?.model,
        latencyMs: info?.latencyMs,
        averageLatencyMs: Math.round(entry.averageLatencyMs),
      });
    },

    recordFailure(provider, failure) {
      return failureCore(provider, failure, false);
    },

    acquireProbeSlot(provider) {
      const entry = state(provider);
      if (trialInFlight(entry)) return false;
      entry.halfOpenTrialAt = now();
      entry.lastProbeAt = now();
      return true;
    },

    releaseProbeSlot(provider) {
      state(provider).halfOpenTrialAt = null;
    },

    getProvidersAwaitingRecovery() {
      return PROVIDER_IDS.filter((id) => {
        const entry = state(id);
        if (!entry.configured) return false;
        if (entry.disabledUntilConfigChange) return false;
        if (cooldownActive(entry)) return false;
        if (trialInFlight(entry)) return false;
        // Cooldown expired (or never existed) but the provider still carries
        // failures: it needs to prove itself before it takes real traffic.
        return entry.consecutiveFailures > 0;
      });
    },

    recordRecoverySuccess(provider, latencyMs) {
      const entry = state(provider);
      entry.lastProbeAt = now();
      manager.recordSuccess(provider, { latencyMs });
      logger?.info?.("provider_recovered", {
        provider,
        latencyMs,
        averageLatencyMs: Math.round(entry.averageLatencyMs),
      });
    },

    recordRecoveryFailure(provider, failure) {
      const entry = state(provider);
      entry.lastProbeAt = now();
      const result = failureCore(provider, failure, true);
      logger?.warn?.("provider_recovery_failed", {
        provider,
        kind: failure.kind,
        cooldownMs: result.cooldownMs,
        cooldownUntil: result.cooldownUntil,
      });
      entry.halfOpenTrialAt = null;
      return result;
    },

    effectiveLatencyMs(provider) {
      const entry = state(provider);
      if (entry.latency.length === 0) return config.assumedLatencyMs;
      return entry.averageLatencyMs;
    },

    reset(provider) {
      if (provider) {
        const previous = states.get(provider);
        const fresh = blank(provider);
        // Configuration is environment-derived, not failure state: keep it.
        if (previous) {
          fresh.configured = previous.configured;
          fresh.configurationIssue = previous.configurationIssue;
        }
        states.set(provider, fresh);
        return;
      }
      for (const id of [...states.keys()]) manager.reset(id);
    },
  };

  return manager;
}

// ---------------------------------------------------------------------------
// Process-wide singleton
// ---------------------------------------------------------------------------
// Health must be shared by every request handler in the process (chat, images,
// titles, admin). It is attached to `globalThis` so a dev-server hot reload does
// not silently create a second, empty source of truth.

const SINGLETON_KEY = Symbol.for("lord.ai.providerHealthManager");

interface SingletonHost {
  [SINGLETON_KEY]?: ProviderHealthManager;
}

export function getProviderHealthManager(): ProviderHealthManager {
  const host = globalThis as unknown as SingletonHost;
  if (!host[SINGLETON_KEY]) {
    host[SINGLETON_KEY] = createProviderHealthManager();
  }
  return host[SINGLETON_KEY];
}

/** Replace the process-wide manager. Intended for tests and hot reload. */
export function setProviderHealthManager(manager: ProviderHealthManager | null): void {
  const host = globalThis as unknown as SingletonHost;
  if (manager) host[SINGLETON_KEY] = manager;
  else delete host[SINGLETON_KEY];
}

/** Clear all recorded health for the process-wide manager. */
export function resetProviderHealth(): void {
  getProviderHealthManager().reset();
}
