// Production-grade provider management for LORD AI.
//
//   provider-types           identity + the `ProviderHealth` contract (Phase 1)
//   provider-policy          failure classification, cooldowns, backoff (2 / 5)
//   provider-health-manager  the single source of truth (1 / 2 / 4 / 6 / 7)
//   provider-router          intelligent routing + per-request guarantees (3)
//   provider-recovery        automatic recovery probes (7)
//   provider-status-report   user-facing status panel (8)
//
// Import from this barrel so call sites never depend on the internal layout.

export {
  PROVIDER_IDS,
  PROVIDER_LABELS,
  FAILURE_KIND_LABELS,
  FAILURE_KIND_USER_TEXT,
  NON_RETRYABLE_FAILURE_KINDS,
  PROVIDER_SCOPED_FAILURE_KINDS,
  isProviderId,
  toProviderId,
  providerLabel,
  type ProviderId,
  type ProviderLabel,
  type ProviderHealth,
  type ProviderHealthStatus,
  type ProviderCircuitState,
  type ProviderFailure,
  type ProviderFailureKind,
  type ProviderQuota,
  type ProviderSkip,
  type ProviderSkipCode,
} from "./provider-types";

export {
  COOLDOWN_WINDOWS,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_RECOVERY_MS,
  MAX_COOLDOWN_MS,
  RETRY_BACKOFF_SCHEDULE_MS,
  RETRY_BUDGET,
  classifyProviderFailure,
  failureKindFromClassification,
  getRetryDelayMs,
  isConfigurationHoldFailure,
  isProviderScopedFailure,
  isRetryableFailureKind,
  parseQuotaHeaders,
  parseRetryAfter,
  resolveCooldownMs,
  shouldRetryFailure,
  type ClassifiedFailure,
  type ClassifyFailureInput,
  type CooldownWindow,
  type RetryDecision,
} from "./provider-policy";

export {
  DEFAULT_PROVIDER_HEALTH_CONFIG,
  createProviderHealthManager,
  getProviderHealthManager,
  resetProviderHealth,
  setProviderHealthManager,
  type ProviderHealthManager,
  type ProviderHealthManagerConfig,
  type ProviderHealthManagerOptions,
  type RecordFailureResult,
} from "./provider-health-manager";

export {
  LATENCY_BUCKET_MS,
  compareProviderRanking,
  createRequestRoutingContext,
  rankProviders,
  selectEligibleProviders,
  type ProviderRankingInput,
  type ProviderSelection,
  type RequestProviderFailure,
  type RequestRoutingContext,
} from "./provider-router";

export {
  DEFAULT_RECOVERY_SWEEP_INTERVAL_MS,
  createProviderRecoveryService,
  summarizeRecoveryQueue,
  type ProviderProbe,
  type ProviderProbeResult,
  type ProviderRecoveryOptions,
  type ProviderRecoveryService,
} from "./provider-recovery";

export {
  STATUS_ICON,
  buildProviderStatusReport,
  describeProviderStatus,
  formatDuration,
  formatProviderStatusMessage,
  formatProviderStatusSummary,
  shortRequestId,
  type ProviderStatusIcon,
  type ProviderStatusLine,
  type ProviderStatusReport,
} from "./provider-status-report";
