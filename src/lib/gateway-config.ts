export const PROBE_TIMEOUT_MS = 6_000;
export const PROBE_MAX_OUTPUT_TOKENS = 16;
export const PROBE_MAX_OUTPUT_TOKENS_BY_PROVIDER: Record<string, number> = {
  gemini: 16,
  openrouter: 16,
  openai: 16,
};
export const PROBE_CACHE_TTL_MS = 45_000;
export const PROBE_MAX_ATTEMPTS = 2;

export const PROVIDER_TIMEOUTS = {
  gemini: 45_000,
  openrouter: 45_000,
  openai: 45_000,
} as const;

export const PROVIDER_TIMEOUT_DEFAULT_MS = 45_000;

export const HEALTH_CACHE_TTL_BY_STATUS = {
  401: 60 * 60 * 1_000,
  403: 60 * 60 * 1_000,
  404: 6 * 60 * 60 * 1_000,
  410: 24 * 60 * 60 * 1_000,
  429: 30_000,
  500: 30_000,
  503: 60_000,
  timeout: 30_000,
  network: 30_000,
  model_unavailable: 6 * 60 * 60 * 1_000,
  invalid_api_key: 60 * 60 * 1_000,
} as const;

export const HEALTH_CACHE_DEFAULT_TTL_MS = 15_000;

export const CB_FAILURE_THRESHOLD = 3;
export const CB_RECOVERY_MS = 30_000;
export const CB_HALF_OPEN_SUCCESS_THRESHOLD = 1;

export const RETRY_POLICY: Record<string, { retryable: boolean; maxRetries: number }> = {
  "404": { retryable: false, maxRetries: 0 },
  "401": { retryable: false, maxRetries: 0 },
  "403": { retryable: false, maxRetries: 0 },
  "422": { retryable: false, maxRetries: 0 },
  "429": { retryable: true, maxRetries: 3 },
  "500": { retryable: true, maxRetries: 2 },
  "503": { retryable: true, maxRetries: 2 },
  timeout: { retryable: true, maxRetries: 2 },
  network: { retryable: true, maxRetries: 2 },
  abort: { retryable: false, maxRetries: 0 },
};

export const RETRY_BACKOFF_BASE_MS = 1_000;
export const RETRY_BACKOFF_MAX_MS = 4_000;
export const RETRY_BACKOFF_MULTIPLIER = 2;

export const MAX_RETRIES_DEFAULT = 2;
export const STREAMING_RETRY_IF_NO_TOKENS = true;

export const STARTUP_VALIDATION_ENABLED = true;
export const STARTUP_VALIDATION_TIMEOUT_MS = 10_000;

export const DYNAMIC_ROUTING_ENABLED = true;
export const MODEL_STATS_ENABLED = true;
export const MODEL_STATS_MAX_SAMPLES = 100;

export const LOG_FORMAT = "json" as const;

export const ERROR_REASON_LABELS: Record<string, string> = {
  invalid_api_key: "Invalid API key",
  malformed_request: "Malformed request",
  invalid_messages: "Invalid messages",
  insufficient_credits: "Insufficient credits",
  rate_limit: "Rate limited",
  model_unavailable: "Model unavailable",
  provider_error: "Provider error",
  unknown: "Unknown error",
  missing_api_key: "Missing API key",
};

// ---------------------------------------------------------------------------
// Image pipeline
// ---------------------------------------------------------------------------
// Image generation has a very different failure profile from chat: a single
// request is slow and billable, providers validate every parameter against a
// per-model schema, and a rejected parameter must be repaired instead of
// retried blindly. These values are intentionally separate from the chat
// gateway knobs so tuning one can never regress the other.
export const IMAGE_CONFIG = {
  /** Per-request provider timeout. Image models are much slower than chat. */
  providerTimeoutMs: 90_000,
  /** Timeout for the (free) model-catalog request. */
  catalogTimeoutMs: 10_000,
  /** How long the model catalog is trusted before it is re-fetched. */
  catalogTtlMs: 30 * 60_000,
  /** Attempts per model, including payload repairs and rate-limit retries. */
  maxAttemptsPerModel: 3,
  /** Hard ceiling on provider calls for one image, across all fallback models. */
  maxTotalAttempts: 10,
  /** How many times a rejected payload may be repaired for the same model. */
  maxPayloadRepairs: 2,
  /** Overall wall-clock budget for one image, including fallbacks. */
  requestDeadlineMs: 150_000,
  /** Images generated concurrently for a single request. */
  maxParallelImages: 4,
  /** Health-cache TTLs for image models, by provider HTTP status. */
  healthTtlByStatus: {
    400: 10 * 60_000,
    401: 60 * 60_000,
    402: 60_000,
    403: 30 * 60_000,
    404: 6 * 60 * 60_000,
    408: 30_000,
    409: 15_000,
    422: 10 * 60_000,
    429: 30_000,
    500: 30_000,
    502: 30_000,
    503: 60_000,
    504: 30_000,
  },
  healthTtlDefaultMs: 30_000,
} as const;

export type GatewayConfig = {
  probeTimeoutMs: number;
  probeMaxOutputTokens: number;
  probeMaxOutputTokensByProvider: Record<string, number>;
  probeCacheTtlMs: number;
  probeMaxAttempts: number;
  providerTimeouts: Record<string, number>;
  providerTimeoutDefaultMs: number;
  healthCacheTtlByStatus: Record<string, number>;
  healthCacheDefaultTtlMs: number;
  cbFailureThreshold: number;
  cbRecoveryMs: number;
  cbHalfOpenSuccessThreshold: number;
  retryPolicy: Record<string, { retryable: boolean; maxRetries: number }>;
  retryBackoffBaseMs: number;
  retryBackoffMaxMs: number;
  retryBackoffMultiplier: number;
  maxRetriesDefault: number;
  streamingRetryIfNoTokens: boolean;
  startupValidationEnabled: boolean;
  startupValidationTimeoutMs: number;
  dynamicRoutingEnabled: boolean;
  modelStatsEnabled: boolean;
  modelStatsMaxSamples: number;
  logFormat: "json" | "pretty";
  errorReasonLabels: Record<string, string>;
};

export const GATEWAY_CONFIG: GatewayConfig = {
  probeTimeoutMs: PROBE_TIMEOUT_MS,
  probeMaxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
  probeMaxOutputTokensByProvider: PROBE_MAX_OUTPUT_TOKENS_BY_PROVIDER,
  probeCacheTtlMs: PROBE_CACHE_TTL_MS,
  probeMaxAttempts: PROBE_MAX_ATTEMPTS,
  providerTimeouts: PROVIDER_TIMEOUTS,
  providerTimeoutDefaultMs: PROVIDER_TIMEOUT_DEFAULT_MS,
  healthCacheTtlByStatus: HEALTH_CACHE_TTL_BY_STATUS,
  healthCacheDefaultTtlMs: HEALTH_CACHE_DEFAULT_TTL_MS,
  cbFailureThreshold: CB_FAILURE_THRESHOLD,
  cbRecoveryMs: CB_RECOVERY_MS,
  cbHalfOpenSuccessThreshold: CB_HALF_OPEN_SUCCESS_THRESHOLD,
  retryPolicy: RETRY_POLICY,
  retryBackoffBaseMs: RETRY_BACKOFF_BASE_MS,
  retryBackoffMaxMs: RETRY_BACKOFF_MAX_MS,
  retryBackoffMultiplier: RETRY_BACKOFF_MULTIPLIER,
  maxRetriesDefault: MAX_RETRIES_DEFAULT,
  streamingRetryIfNoTokens: STREAMING_RETRY_IF_NO_TOKENS,
  startupValidationEnabled: STARTUP_VALIDATION_ENABLED,
  startupValidationTimeoutMs: STARTUP_VALIDATION_TIMEOUT_MS,
  dynamicRoutingEnabled: DYNAMIC_ROUTING_ENABLED,
  modelStatsEnabled: MODEL_STATS_ENABLED,
  modelStatsMaxSamples: MODEL_STATS_MAX_SAMPLES,
  logFormat: LOG_FORMAT,
  errorReasonLabels: ERROR_REASON_LABELS,
};
