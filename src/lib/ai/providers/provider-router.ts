// Intelligent routing (Phase 3) + per-request routing context.
//
// Before every request the router:
//   1. reads provider health from the `ProviderHealthManager`;
//   2. drops providers that are unhealthy (unconfigured, credential-held, or in
//      cooldown) — with zero network calls;
//   3. sorts the survivors by lowest latency, then highest success rate, then
//      fewest recent failures;
//   4. hands the caller an ordered, de-duplicated plan.
//
// The per-request context guarantees the property this whole redesign exists
// for: **a provider is never contacted twice in the same request once it has
// failed**. A 429 from Gemini removes every remaining Gemini candidate from the
// plan immediately.

import type { ProviderHealthManager } from "./provider-health-manager";
import {
  PROVIDER_IDS,
  type ProviderFailureKind,
  type ProviderHealth,
  type ProviderId,
  type ProviderSkip,
} from "./provider-types";
import { isProviderScopedFailure } from "./provider-policy";

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface ProviderRankingInput {
  provider: ProviderId;
  health: ProviderHealth;
  /** Latency used for ranking (measured average, or the configured assumption). */
  latencyMs: number;
  /** Position in the caller's preferred order; used as the final tie-break. */
  preferenceIndex: number;
}

/**
 * Latency is bucketed before comparison so millisecond noise cannot reorder
 * providers on every request (which would defeat client reuse and caching).
 */
export const LATENCY_BUCKET_MS = 100;

/** Healthy providers always rank above degraded (half-open) ones. */
function statusRank(health: ProviderHealth): number {
  switch (health.status) {
    case "healthy":
      return 0;
    case "degraded":
      return 1;
    case "rate_limited":
      return 2;
    default:
      return 3;
  }
}

export function compareProviderRanking(a: ProviderRankingInput, b: ProviderRankingInput): number {
  const statusDelta = statusRank(a.health) - statusRank(b.health);
  if (statusDelta !== 0) return statusDelta;

  const latencyA = Math.round(a.latencyMs / LATENCY_BUCKET_MS);
  const latencyB = Math.round(b.latencyMs / LATENCY_BUCKET_MS);
  if (latencyA !== latencyB) return latencyA - latencyB;

  // Highest success rate wins (rounded so tiny sample noise does not flap).
  const successA = Math.round(a.health.successRate * 100);
  const successB = Math.round(b.health.successRate * 100);
  if (successA !== successB) return successB - successA;

  // Fewest recent failures wins.
  if (a.health.failureCount !== b.health.failureCount) {
    return a.health.failureCount - b.health.failureCount;
  }

  return a.preferenceIndex - b.preferenceIndex;
}

/**
 * Rank the given providers best-first. `preferred` supplies the caller's own
 * order (for example a routing mode's candidate order) and is used as the final
 * tie-break so configuration still matters when health is equivalent.
 */
export function rankProviders(
  manager: ProviderHealthManager,
  providers: readonly ProviderId[],
  preferred: readonly ProviderId[] = providers,
): ProviderId[] {
  const preferenceOf = new Map<ProviderId, number>();
  preferred.forEach((id, index) => {
    if (!preferenceOf.has(id)) preferenceOf.set(id, index);
  });

  const inputs: ProviderRankingInput[] = [...new Set(providers)].map((provider) => ({
    provider,
    health: manager.get(provider),
    latencyMs: manager.effectiveLatencyMs(provider),
    preferenceIndex: preferenceOf.get(provider) ?? PROVIDER_IDS.length + 1,
  }));

  return inputs.sort(compareProviderRanking).map((entry) => entry.provider);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface ProviderSelection {
  /** Providers that may be contacted, best-first. */
  eligible: ProviderId[];
  /** Providers that were skipped, with the reason. */
  skipped: ProviderSkip[];
  /** Every provider considered, in the caller's order. */
  considered: ProviderId[];
}

/**
 * Read health and return only the providers that may be contacted, best-first.
 *
 * This is the Phase 6 fast path: for a provider in cooldown the answer comes
 * from memory and **no API request is issued**.
 */
export function selectEligibleProviders(
  manager: ProviderHealthManager,
  providers: readonly ProviderId[],
  context?: RequestRoutingContext,
): ProviderSelection {
  const considered = [...new Set(providers)];
  const eligible: ProviderId[] = [];
  const skipped: ProviderSkip[] = [];

  for (const provider of considered) {
    const requestSkip = context?.getSkip(provider);
    if (requestSkip) {
      skipped.push(requestSkip);
      continue;
    }
    const skip = manager.getSkip(provider);
    if (skip) {
      skipped.push(skip);
      continue;
    }
    eligible.push(provider);
  }

  return {
    eligible: rankProviders(manager, eligible, considered),
    skipped,
    considered,
  };
}

// ---------------------------------------------------------------------------
// Per-request routing context
// ---------------------------------------------------------------------------

export interface RequestProviderFailure {
  provider: ProviderId;
  kind: ProviderFailureKind;
  status?: number;
  model?: string;
  message?: string;
  at: number;
}

/**
 * Tracks what happened to each provider during a single request.
 *
 * Rules enforced here:
 *   - a provider that failed with a provider-scoped error (429, auth, 5xx,
 *     timeout, network) is removed from the rest of this request;
 *   - a model-scoped error (404 / invalid payload) only removes that model, so
 *     the provider's other models are still tried;
 *   - the same provider/model pair is never attempted twice.
 */
export interface RequestRoutingContext {
  readonly requestId: string;
  /** Mark that we are about to contact this provider/model. */
  markAttempt(provider: ProviderId, model?: string): void;
  /** Record a failure; returns true when the provider is now excluded. */
  recordFailure(failure: Omit<RequestProviderFailure, "at">): boolean;
  /** Non-null when this provider must not be contacted again in this request. */
  getSkip(provider: ProviderId): ProviderSkip | null;
  /** True when this exact provider/model pair was already attempted. */
  hasAttempted(provider: ProviderId, model?: string): boolean;
  /** True when this specific model is known-dead for this request. */
  isModelExcluded(provider: ProviderId, model: string): boolean;
  /** Providers actually contacted, in order. */
  readonly attemptedProviders: ProviderId[];
  /** Providers excluded after a provider-scoped failure. */
  readonly exhaustedProviders: ProviderId[];
  readonly failures: RequestProviderFailure[];
}

export function createRequestRoutingContext(
  requestId: string,
  options: { now?: () => number } = {},
): RequestRoutingContext {
  const now = options.now ?? Date.now;
  const attemptedProviders: ProviderId[] = [];
  const attemptedPairs = new Set<string>();
  const exhausted = new Map<ProviderId, RequestProviderFailure>();
  const excludedModels = new Set<string>();
  const failures: RequestProviderFailure[] = [];

  const pairKey = (provider: ProviderId, model?: string) => `${provider}:${model ?? "*"}`;

  return {
    requestId,
    attemptedProviders,
    get exhaustedProviders() {
      return [...exhausted.keys()];
    },
    failures,

    markAttempt(provider, model) {
      if (!attemptedProviders.includes(provider)) attemptedProviders.push(provider);
      attemptedPairs.add(pairKey(provider, model));
    },

    hasAttempted(provider, model) {
      return attemptedPairs.has(pairKey(provider, model));
    },

    isModelExcluded(provider, model) {
      return excludedModels.has(pairKey(provider, model));
    },

    recordFailure(failure) {
      const entry: RequestProviderFailure = { ...failure, at: now() };
      failures.push(entry);
      if (failure.model) excludedModels.add(pairKey(failure.provider, failure.model));
      if (isProviderScopedFailure(failure.kind)) {
        exhausted.set(failure.provider, entry);
        return true;
      }
      return false;
    },

    getSkip(provider) {
      const failure = exhausted.get(provider);
      if (!failure) return null;
      return {
        provider,
        code: "already_failed_this_request",
        detail: `Already failed in this request (${failure.kind}${
          failure.status ? ` ${failure.status}` : ""
        }); not retried`,
        kind: failure.kind,
      };
    },
  };
}
