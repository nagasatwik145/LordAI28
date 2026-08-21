// Failure classification, cooldown policy, and retry/backoff policy.
//
// These are the rules the whole provider-management system is built on:
//
//   Phase 2 — Smart cooldown
//     429            -> 10–15 minutes            (or the advertised Retry-After)
//     401 / 403      -> disabled until the configuration changes
//     5xx            -> 2–5 minutes
//     timeout/network-> 30–60 seconds
//
//   Phase 5 — Exponential backoff
//     retry 1 -> 500ms, retry 2 -> 1s, retry 3 -> 2s, and never retry an
//     invalid API key, a permission denial, an invalid request, or an invalid
//     model.
//
// Everything is pure and injectable (`now`, `random`) so the policies can be
// asserted deterministically in tests.

import {
  NON_RETRYABLE_FAILURE_KINDS,
  PROVIDER_SCOPED_FAILURE_KINDS,
  type ProviderFailureKind,
  type ProviderQuota,
} from "./provider-types";

// ---------------------------------------------------------------------------
// Cooldown policy
// ---------------------------------------------------------------------------

export interface CooldownWindow {
  minMs: number;
  maxMs: number;
}

/**
 * `Infinity` is not used as a duration anywhere; an auth failure is modelled as
 * a *configuration hold* (see `ProviderHealth.disabledUntilConfigChange`)
 * instead of an absurdly long timer, because only an operator can clear it.
 */
export const COOLDOWN_WINDOWS: Record<ProviderFailureKind, CooldownWindow> = {
  // Phase 2: 429 -> 10–15 minutes. Long enough that we stop hammering a
  // provider that has already told us to stop.
  rate_limit: { minMs: 10 * 60_000, maxMs: 15 * 60_000 },
  // A daily/monthly quota does not recover in minutes; hold the full window.
  quota_exceeded: { minMs: 15 * 60_000, maxMs: 15 * 60_000 },
  // Handled as a configuration hold, not a timer. Kept here for completeness.
  auth: { minMs: 0, maxMs: 0 },
  // Phase 2: 5xx -> 2–5 minutes.
  server_error: { minMs: 2 * 60_000, maxMs: 5 * 60_000 },
  // Phase 2: network/timeout -> 30–60 seconds.
  timeout: { minMs: 30_000, maxMs: 60_000 },
  network: { minMs: 30_000, maxMs: 60_000 },
  // Client-side/one-off conditions: never punish the provider.
  aborted: { minMs: 0, maxMs: 0 },
  invalid_request: { minMs: 0, maxMs: 0 },
  invalid_model: { minMs: 0, maxMs: 0 },
  unknown: { minMs: 30_000, maxMs: 60_000 },
};

/** Upper bound for any single cooldown, including circuit-breaker escalation. */
export const MAX_COOLDOWN_MS = 60 * 60_000;

/** Extra cooldown applied once the circuit breaker trips (Phase 4). */
export const CIRCUIT_RECOVERY_MS = 60_000;

/** Consecutive failures that open the circuit (Phase 4). */
export const CIRCUIT_FAILURE_THRESHOLD = 5;

/** True when this failure kind should put the whole provider into cooldown. */
export function isProviderScopedFailure(kind: ProviderFailureKind): boolean {
  return PROVIDER_SCOPED_FAILURE_KINDS.includes(kind);
}

/** True when a failure of this kind means "stop until an operator acts". */
export function isConfigurationHoldFailure(kind: ProviderFailureKind): boolean {
  return kind === "auth";
}

export interface ResolveCooldownOptions {
  kind: ProviderFailureKind;
  /** `Retry-After` in ms, when the provider advertised one. */
  retryAfterMs?: number;
  /**
   * How many times the circuit has already opened for this provider. Each
   * additional trip doubles the cooldown, capped at `MAX_COOLDOWN_MS`.
   */
  circuitOpenCount?: number;
  /** True when this failure tripped (or kept open) the circuit breaker. */
  circuitTripped?: boolean;
  /** Injectable RNG in [0, 1). Defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Resolve the cooldown for a failure.
 *
 * The value is jittered across the policy window so a fleet of servers does not
 * retry a rate-limited provider in lockstep. An advertised `Retry-After` always
 * wins when it is longer than our own window.
 */
export function resolveCooldownMs(options: ResolveCooldownOptions): number {
  const { kind, retryAfterMs, circuitOpenCount = 0, circuitTripped = false } = options;
  const random = options.random ?? Math.random;

  if (isConfigurationHoldFailure(kind)) return 0;
  if (!isProviderScopedFailure(kind)) return 0;

  const window = COOLDOWN_WINDOWS[kind];
  const span = Math.max(0, window.maxMs - window.minMs);
  let cooldown = window.minMs + Math.floor(span * clamp01(random()));

  // The provider explicitly told us when to come back — respect it.
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    cooldown = Math.max(cooldown, Math.ceil(retryAfterMs));
  }

  // Circuit-breaker escalation: repeated trips back off exponentially.
  if (circuitTripped) {
    const escalation = CIRCUIT_RECOVERY_MS * 2 ** Math.max(0, circuitOpenCount);
    cooldown = Math.max(cooldown, escalation);
  }

  return Math.min(cooldown, MAX_COOLDOWN_MS);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999999;
  return value;
}

// ---------------------------------------------------------------------------
// Retry policy (Phase 5)
// ---------------------------------------------------------------------------

/** Exponential backoff schedule: 1st retry 500ms, 2nd 1s, 3rd 2s. */
export const RETRY_BACKOFF_SCHEDULE_MS: readonly number[] = [500, 1_000, 2_000] as const;

/**
 * How many in-place retries a failure kind may have *on the same provider*.
 *
 * Everything that is a definitive answer from the provider (429, auth, invalid
 * request/model) is zero: we fail over instead, which is both faster and the
 * behaviour the spec demands ("No provider is retried after a 429 within the
 * same request").
 *
 * A `timeout` is also zero — we already waited out the provider deadline, so
 * repeating it would multiply the user's wait. Only a fast-failing transport
 * error (`network`) is worth an immediate retry.
 */
export const RETRY_BUDGET: Record<ProviderFailureKind, number> = {
  rate_limit: 0,
  quota_exceeded: 0,
  auth: 0,
  invalid_request: 0,
  invalid_model: 0,
  aborted: 0,
  timeout: 0,
  server_error: 0,
  network: 2,
  unknown: 0,
};

/** Never retry: invalid API key, permission denied, invalid request, invalid model. */
export function isRetryableFailureKind(kind: ProviderFailureKind): boolean {
  if (NON_RETRYABLE_FAILURE_KINDS.includes(kind)) return false;
  return RETRY_BUDGET[kind] > 0;
}

/** Delay before retry number `attempt` (1-based). Clamped to the last step. */
export function getRetryDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return RETRY_BACKOFF_SCHEDULE_MS[0];
  const index = Math.min(Math.floor(attempt) - 1, RETRY_BACKOFF_SCHEDULE_MS.length - 1);
  return RETRY_BACKOFF_SCHEDULE_MS[index];
}

export interface RetryDecision {
  retry: boolean;
  /** 1-based retry number that would be performed. */
  attempt: number;
  delayMs: number;
  reason: string;
}

/**
 * Decide whether a failure may be retried against the same provider.
 *
 * @param kind             classified failure
 * @param retriesUsed      retries already performed for this provider in this request
 * @param providerInCooldown true when the provider is now cooling down — a
 *                           provider in cooldown is *never* retried (Phase 2/6)
 */
export function shouldRetryFailure(
  kind: ProviderFailureKind,
  retriesUsed: number,
  providerInCooldown = false,
): RetryDecision {
  const attempt = retriesUsed + 1;
  if (providerInCooldown) {
    return { retry: false, attempt, delayMs: 0, reason: "provider is in cooldown" };
  }
  if (!isRetryableFailureKind(kind)) {
    return { retry: false, attempt, delayMs: 0, reason: `${kind} is never retried` };
  }
  if (retriesUsed >= RETRY_BUDGET[kind]) {
    return { retry: false, attempt, delayMs: 0, reason: `retry budget exhausted for ${kind}` };
  }
  return {
    retry: true,
    attempt,
    delayMs: getRetryDelayMs(attempt),
    reason: `${kind} is transient`,
  };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Provider bodies that mean "this key was rejected", regardless of the HTTP
 * status used to deliver it. Gemini famously reports an invalid key as
 * `400 API_KEY_INVALID`, which must be treated as auth and not as a malformed
 * request — otherwise the gateway keeps retrying with the same bad key.
 */
const AUTH_BODY_PATTERN =
  /api[\s_-]?key not valid|api[\s_-]?key[\s_-]?invalid|invalid[\s_-]api[\s_-]?key|incorrect api key|expired api key|missing api key|invalid authentication|unauthenticated|no auth credentials|permission denied|caller does not have permission|insufficient permission|forbidden/i;

/** Bodies that mean a *quota* (not a burst rate) is exhausted. */
const QUOTA_BODY_PATTERN =
  /quota|daily limit|monthly limit|credit|billing|insufficient_quota|exceeded your current|free[- ]tier limit|usage limit/i;

const TIMEOUT_PATTERN = /timed?\s?out|timeout|deadline|etimedout|esockettimedout/i;
const ABORT_PATTERN = /abort|cancell?ed/i;
const NETWORK_PATTERN =
  /fetch failed|network|econnreset|econnrefused|enotfound|eai_again|socket hang up|tls|dns|und_err/i;
const MODEL_PATTERN =
  /model not found|model unavailable|does not exist|is not found|no such model/i;

export interface ClassifyFailureInput {
  status?: number;
  /** Raw provider body or error message. */
  body?: string;
  message?: string;
  /** Pre-known transport kind from a fetch wrapper. */
  transport?: "network" | "timeout" | "abort" | "parse" | "api";
  /** Raw `Retry-After` header value (seconds or HTTP-date). */
  retryAfterHeader?: string | null;
  /** Reference clock for HTTP-date `Retry-After` parsing. */
  now?: number;
}

export interface ClassifiedFailure {
  kind: ProviderFailureKind;
  status?: number;
  message?: string;
  retryAfterMs?: number;
}

/** Map an HTTP status + body onto the normalized failure taxonomy. */
export function classifyProviderFailure(input: ClassifyFailureInput): ClassifiedFailure {
  const text = `${input.message ?? ""} ${input.body ?? ""}`.trim();
  const retryAfterMs = parseRetryAfter(input.retryAfterHeader, input.now);
  const status = input.status;
  const base = { status, message: input.message ?? undefined, retryAfterMs };

  // Transport-level outcomes are unambiguous — trust them first.
  if (input.transport === "abort") return { ...base, kind: "aborted" };
  if (input.transport === "timeout") return { ...base, kind: "timeout" };
  if (input.transport === "network" && status === undefined) return { ...base, kind: "network" };

  if (typeof status === "number" && status > 0) {
    if (status === 401 || status === 403) return { ...base, kind: "auth" };
    if (status === 429) {
      return {
        ...base,
        kind: QUOTA_BODY_PATTERN.test(text) ? "quota_exceeded" : "rate_limit",
      };
    }
    if (status === 402) return { ...base, kind: "quota_exceeded" };
    if (status === 404 || status === 410) return { ...base, kind: "invalid_model" };
    if (status === 408 || status === 504) return { ...base, kind: "timeout" };
    if (status === 400 || status === 422) {
      // An auth rejection delivered as a 400 is still an auth rejection.
      if (AUTH_BODY_PATTERN.test(text)) return { ...base, kind: "auth" };
      if (QUOTA_BODY_PATTERN.test(text) && /limit|quota/i.test(text)) {
        return { ...base, kind: "quota_exceeded" };
      }
      if (MODEL_PATTERN.test(text)) return { ...base, kind: "invalid_model" };
      return { ...base, kind: "invalid_request" };
    }
    if (status >= 500) return { ...base, kind: "server_error" };
  }

  // No usable status: fall back to message shape.
  if (!text) return { ...base, kind: "unknown" };
  if (ABORT_PATTERN.test(text) && !TIMEOUT_PATTERN.test(text)) return { ...base, kind: "aborted" };
  if (TIMEOUT_PATTERN.test(text)) return { ...base, kind: "timeout" };
  if (AUTH_BODY_PATTERN.test(text)) return { ...base, kind: "auth" };
  if (/429|rate limit|too many requests/i.test(text)) {
    return { ...base, kind: QUOTA_BODY_PATTERN.test(text) ? "quota_exceeded" : "rate_limit" };
  }
  if (QUOTA_BODY_PATTERN.test(text)) return { ...base, kind: "quota_exceeded" };
  if (MODEL_PATTERN.test(text)) return { ...base, kind: "invalid_model" };
  if (NETWORK_PATTERN.test(text)) return { ...base, kind: "network" };
  return { ...base, kind: "unknown" };
}

/**
 * Map the legacy `classifyModelError` reason (from `lord-config.ts`) onto the
 * normalized taxonomy. Structural typing keeps this module import-free.
 */
export function failureKindFromClassification(classification: {
  reason: string;
  status?: number;
  providerMessage?: string;
}): ProviderFailureKind {
  const { reason, status, providerMessage } = classification;
  switch (reason) {
    case "invalid_api_key":
      return "auth";
    case "rate_limit":
      return classifyProviderFailure({ status: status ?? 429, body: providerMessage }).kind;
    case "insufficient_credits":
      return "quota_exceeded";
    case "model_unavailable":
      return "invalid_model";
    case "malformed_request":
    case "invalid_messages":
      return AUTH_BODY_PATTERN.test(providerMessage ?? "") ? "auth" : "invalid_request";
    case "provider_error":
      return classifyProviderFailure({
        status,
        body: providerMessage,
        transport: status === undefined || status === 0 ? "network" : undefined,
      }).kind;
    default:
      return classifyProviderFailure({ status, body: providerMessage }).kind;
  }
}

/** Parse `Retry-After` (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(
  header: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.round(seconds * 1_000) : undefined;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  const delta = date - now;
  return delta > 0 ? delta : undefined;
}

// ---------------------------------------------------------------------------
// Quota headers
// ---------------------------------------------------------------------------

const LIMIT_HEADERS = [
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit",
  "ratelimit-limit",
  "x-rate-limit-limit",
];
const REMAINING_HEADERS = [
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining",
  "ratelimit-remaining",
  "x-rate-limit-remaining",
];
const RESET_HEADERS = [
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset",
  "ratelimit-reset",
  "x-rate-limit-reset",
];

/**
 * Extract remaining-quota information from response headers, when the provider
 * advertises it. Returns `null` when nothing usable is present so the dashboard
 * can honestly show "unknown" instead of a fabricated number.
 */
export function parseQuotaHeaders(
  headers: Record<string, string> | undefined | null,
  now = Date.now(),
): ProviderQuota | null {
  if (!headers) return null;
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;

  const limit = firstNumber(lower, LIMIT_HEADERS);
  const remaining = firstNumber(lower, REMAINING_HEADERS);
  const resetRaw = firstPresent(lower, RESET_HEADERS);
  const resetAt = resetRaw ? parseResetValue(resetRaw, now) : null;

  if (limit === null && remaining === null && resetAt === null) return null;
  return {
    limit,
    remaining,
    resetAt,
    source: firstPresentKey(lower, [...REMAINING_HEADERS, ...LIMIT_HEADERS, ...RESET_HEADERS]),
  };
}

function firstPresent(headers: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

function firstPresentKey(headers: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    if (headers[name] !== undefined && headers[name] !== "") return name;
  }
  return undefined;
}

function firstNumber(headers: Record<string, string>, names: string[]): number | null {
  const raw = firstPresent(headers, names);
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** `x-ratelimit-reset` is variously epoch-seconds, ms, `12s`, or `1m30s`. */
function parseResetValue(raw: string, now: number): number | null {
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return numeric; // epoch ms
    if (numeric > 1e9) return numeric * 1_000; // epoch seconds
    return now + numeric * 1_000; // delta seconds
  }
  const match = raw.match(/^(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?$/i);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const minutes = match[1] ? Number(match[1]) : 0;
  const seconds = match[2] ? Number(match[2]) : 0;
  const millis = match[3] ? Number(match[3]) : 0;
  return now + minutes * 60_000 + seconds * 1_000 + millis;
}
