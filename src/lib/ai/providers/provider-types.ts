// Canonical provider identity + health vocabulary for LORD AI.
//
// This module is deliberately dependency-free (no imports at all) so it can be
// consumed by server code, client code, and `lord-config.ts` without creating
// an import cycle. Everything else in the provider-management system builds on
// these types.

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Every provider LORD can talk to, chat or image. */
export type ProviderId = "gemini" | "openrouter" | "openai" | "cloudflare";

/** Operator/user-facing provider name. */
export type ProviderLabel = "Gemini" | "OpenRouter" | "OpenAI" | "Cloudflare";

/**
 * Canonical order. Used as the stable tie-break when two providers are equally
 * healthy, so routing never flaps between equivalent options.
 */
export const PROVIDER_IDS: readonly ProviderId[] = [
  "gemini",
  "openai",
  "openrouter",
  "cloudflare",
] as const;

export const PROVIDER_LABELS: Record<ProviderId, ProviderLabel> = {
  gemini: "Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  cloudflare: "Cloudflare",
};

const PROVIDER_ID_BY_LABEL: Record<string, ProviderId> = {
  gemini: "gemini",
  openai: "openai",
  openrouter: "openrouter",
  cloudflare: "cloudflare",
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDER_ID_BY_LABEL;
}

/** Resolve a label ("OpenRouter") or id ("openrouter") to a `ProviderId`. */
export function toProviderId(value: string): ProviderId | null {
  return PROVIDER_ID_BY_LABEL[value.trim().toLowerCase()] ?? null;
}

export function providerLabel(provider: ProviderId): ProviderLabel {
  return PROVIDER_LABELS[provider];
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * The four states a provider can be in.
 *
 *  - `healthy`      usable now; recent successes, no cooldown
 *  - `degraded`     usable now, but it failed recently (half-open / recovering)
 *  - `rate_limited` unusable: the provider returned 429 / quota exhaustion
 *  - `offline`      unusable: unconfigured, credentials rejected, 5xx, timeouts
 */
export type ProviderHealthStatus = "healthy" | "degraded" | "rate_limited" | "offline";

/** Circuit-breaker state (Phase 4). */
export type ProviderCircuitState = "closed" | "open" | "half_open";

/**
 * Normalized failure taxonomy. Every provider error must map onto exactly one
 * of these, because the cooldown and retry policies are keyed off it.
 */
export type ProviderFailureKind =
  /** HTTP 429 — request rate exceeded. */
  | "rate_limit"
  /** HTTP 429 with a daily/monthly quota message, or HTTP 402. */
  | "quota_exceeded"
  /** HTTP 401 / 403, or a body that says the key itself was rejected. */
  | "auth"
  /** HTTP 5xx. */
  | "server_error"
  /** The request exceeded our own deadline. */
  | "timeout"
  /** DNS / socket / TLS / `fetch failed`. */
  | "network"
  /** The caller (or the user) aborted. Never counted against the provider. */
  | "aborted"
  /** HTTP 400 / 422 — our payload was wrong. Never retried, never penalized. */
  | "invalid_request"
  /** HTTP 404 / 410 — that *model* is gone. Scoped to the model, not the provider. */
  | "invalid_model"
  /** Anything we could not classify. */
  | "unknown";

/** Failure kinds that must never trigger a retry (Phase 5). */
export const NON_RETRYABLE_FAILURE_KINDS: readonly ProviderFailureKind[] = [
  "auth",
  "invalid_request",
  "invalid_model",
  "rate_limit",
  "quota_exceeded",
  "aborted",
] as const;

/**
 * Failure kinds that are the provider's fault and therefore put the *provider*
 * into cooldown. `invalid_request` / `invalid_model` / `aborted` are excluded:
 * they are scoped to one request or one model.
 */
export const PROVIDER_SCOPED_FAILURE_KINDS: readonly ProviderFailureKind[] = [
  "rate_limit",
  "quota_exceeded",
  "auth",
  "server_error",
  "timeout",
  "network",
  "unknown",
] as const;

/** Human-readable reason shown in logs and the admin dashboard. */
export const FAILURE_KIND_LABELS: Record<ProviderFailureKind, string> = {
  rate_limit: "Rate limited",
  quota_exceeded: "Quota exceeded",
  auth: "Credentials rejected",
  server_error: "Provider error",
  timeout: "Timed out",
  network: "Network error",
  aborted: "Aborted",
  invalid_request: "Invalid request",
  invalid_model: "Model unavailable",
  unknown: "Unknown error",
};

/** Short status text for the user-facing provider table (Phase 8). */
export const FAILURE_KIND_USER_TEXT: Record<ProviderFailureKind, string> = {
  rate_limit: "Rate limited",
  quota_exceeded: "Quota exceeded",
  auth: "Configuration error",
  server_error: "Provider error",
  timeout: "Timed out",
  network: "Network error",
  aborted: "Cancelled",
  invalid_request: "Request rejected",
  invalid_model: "Model unavailable",
  unknown: "Temporarily unavailable",
};

// ---------------------------------------------------------------------------
// Failure + quota payloads
// ---------------------------------------------------------------------------

/** A single provider failure, already classified. */
export interface ProviderFailure {
  kind: ProviderFailureKind;
  /** HTTP status when the failure came from a response. */
  status?: number;
  /** Safe, human-readable detail. Never a secret. */
  message?: string;
  /** Model that produced the failure, when known. */
  model?: string;
  /** `Retry-After` (ms) advertised by the provider; always respected. */
  retryAfterMs?: number;
  /** Quota headers observed on the failing response. */
  quota?: ProviderQuota;
  /** Observed latency for the failed call, used for the latency average. */
  latencyMs?: number;
}

/** Remaining-quota information, when the provider advertises it. */
export interface ProviderQuota {
  limit: number | null;
  remaining: number | null;
  /** Epoch ms at which the window resets. */
  resetAt: number | null;
  /** Where the numbers came from, e.g. `"x-ratelimit-remaining-requests"`. */
  source?: string;
}

// ---------------------------------------------------------------------------
// Public health snapshot — the single source of truth (Phase 1)
// ---------------------------------------------------------------------------

/**
 * Immutable snapshot of one provider's health. The first seven fields are the
 * contract required by the LORD provider-management spec; the rest is the
 * additional telemetry the admin dashboard and the router need.
 */
export interface ProviderHealth {
  /** Display name: "Gemini" | "OpenAI" | "OpenRouter" | "Cloudflare". */
  provider: ProviderLabel;
  status: ProviderHealthStatus;
  lastSuccess: Date | null;
  lastFailure: Date | null;
  /** Consecutive failures since the last success. Drives the circuit breaker. */
  failureCount: number;
  cooldownUntil?: Date;
  averageLatencyMs: number;

  // --- routing + dashboard telemetry -------------------------------------
  /** Lowercase id used everywhere in code. */
  providerId: ProviderId;
  /** True when the provider has usable credentials. */
  configured: boolean;
  /** Why the provider is not configured, when `configured` is false. */
  configurationIssue: string | null;
  circuitState: ProviderCircuitState;
  /** True after a 401/403: stays disabled until the configuration changes. */
  disabledUntilConfigChange: boolean;
  consecutiveSuccesses: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  /** Requests counted since UTC midnight. */
  requestsToday: number;
  /** 0–1. Returns 1 for a provider that has never been used. */
  successRate: number;
  /** Milliseconds left on the cooldown; 0 when not in cooldown. */
  cooldownRemainingMs: number;
  cooldownReason: string | null;
  lastFailureKind: ProviderFailureKind | null;
  lastFailureStatus: number | null;
  lastFailureMessage: string | null;
  /** Most recent model used on this provider. */
  currentModel: string | null;
  quota: ProviderQuota | null;
  /** Epoch ms of the last health-check probe, if any. */
  lastProbeAt: number | null;
}

// ---------------------------------------------------------------------------
// Routing decisions
// ---------------------------------------------------------------------------

export type ProviderSkipCode =
  | "not_configured"
  | "disabled"
  | "cooldown"
  | "circuit_open"
  | "already_failed_this_request"
  | "half_open_trial_in_flight";

/** Why a provider was skipped, so routing decisions are always explainable. */
export interface ProviderSkip {
  provider: ProviderId;
  code: ProviderSkipCode;
  /** Operator-facing sentence. */
  detail: string;
  /** Epoch ms when the provider becomes eligible again, when known. */
  retryAt?: number;
  remainingMs?: number;
  kind?: ProviderFailureKind;
}
