import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StreamTextResult,
} from "ai";

import { estimateCost } from "@/lib/model-cost";
import type { TokenUsageEvent } from "@/lib/token-usage-store";
import type { ProviderStatus } from "@/lib/api-error";
import {
  LORD_MODE_LABELS,
  LORD_MODELS,
  classifyModelError,
  isAuthFailure,
  isAuthFailureMessage,
  OpenRouterClientError,
  type LordMode,
  type ModelAttempt,
  type ProviderName,
  type Candidate,
  type ModelErrorClassification,
  PROVIDER_CONFIG,
  getModeCandidates,
  resolveCandidate,
  buildAllCandidates,
} from "./lord-config";
import { GATEWAY_CONFIG } from "./gateway-config";
import { createHealthCache, type HealthCacheEntry, type HealthCache } from "./provider-health";
import { createCircuitBreaker, type CircuitBreaker } from "./circuit-breaker";
import { createModelStatsStore, type ModelStatsStore } from "./model-stats";
import { createLogger, type Logger } from "./gateway-logger";
import { OPENROUTER_DEFAULT_MODEL } from "./openrouter-provider";
import {
  ensureServerEnvLoaded,
  getProviderEnvSummaries,
  readEnvApiKey,
  summarizeSecret,
  type EnvKeySummary,
} from "./env.server";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_CHAT_PATH = "/chat/completions";
const OPENROUTER_REFERER = process.env.OPENROUTER_REFERER || "https://lordai.app";
const OPENROUTER_TITLE = process.env.OPENROUTER_TITLE || "LordAI";

const PROVIDER_LABELS: Record<ProviderName, string> = {
  gemini: "Gemini",
  openrouter: "OpenRouter",
  openai: "OpenAI",
};

// Read a provider key from process.env, normalized exactly as it is handed to
// the provider SDK. Reading through this one helper guarantees the SDK, the
// diagnostics, and the on-the-wire verification all observe the same value.
export function getProviderApiKey(provider: ProviderName): string | undefined {
  return readEnvApiKey(PROVIDER_CONFIG[provider].apiKeyEnv);
}

// ---------------------------------------------------------------------------
// Key validation (never logs the key itself)
// ---------------------------------------------------------------------------

export function validateApiKey(apiKey: string | undefined): { valid: boolean; issue?: string } {
  if (!apiKey) return { valid: false, issue: "missing" };
  if (apiKey !== apiKey.trim()) return { valid: false, issue: "contains surrounding whitespace" };
  if (/\s/.test(apiKey)) return { valid: false, issue: "contains whitespace" };
  if (apiKey.includes('"') || apiKey.includes("'"))
    return { valid: false, issue: "contains quotes" };
  if (apiKey.includes("\n") || apiKey.includes("\r"))
    return { valid: false, issue: "contains newline" };
  return { valid: true };
}

export function validateOpenRouterApiKey(apiKey: string | undefined): {
  valid: boolean;
  issue?: string;
} {
  return validateApiKey(apiKey);
}

// ---------------------------------------------------------------------------
// Environment / local-vs-Vercel diagnostics
// ---------------------------------------------------------------------------

let diagnosticsLogged = false;

function summarizeApiKey(apiKey: string | undefined) {
  return {
    exists: Boolean(apiKey),
    first8: apiKey ? apiKey.slice(0, 8) : undefined,
    length: apiKey?.length ?? 0,
  };
}

export function getLordEnvironmentDiagnostics() {
  ensureServerEnvLoaded();
  const isEdge = typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined";
  const geminiKey = getProviderApiKey("gemini");
  const openaiKey = getProviderApiKey("openai");
  const openRouterKey = getProviderApiKey("openrouter");
  return {
    hasGeminiKey: !!geminiKey,
    hasOpenRouterKey: !!openRouterKey,
    hasOpenAiKey: !!openaiKey,
    providers: {
      gemini: {
        configured: !!geminiKey && validateApiKey(geminiKey).valid,
        key: summarizeApiKey(geminiKey),
      },
      openai: {
        configured: !!openaiKey && validateApiKey(openaiKey).valid,
        key: summarizeApiKey(openaiKey),
      },
      openrouter: {
        configured: !!openRouterKey && validateApiKey(openRouterKey).valid,
        key: summarizeApiKey(openRouterKey),
      },
    },
    nodeVersion: process.version,
    runtime: isEdge ? "edge" : "node",
    platform: typeof process.platform === "string" ? process.platform : "unknown",
    deployedOn: process.env.VERCEL ? "vercel" : (process.env.NITRO_PRESET ?? "local"),
  };
}

// ---------------------------------------------------------------------------
// Startup configuration diagnostics (task 8)
// ---------------------------------------------------------------------------

export interface ProviderConfigurationDiagnostic {
  provider: ProviderName;
  label: string;
  configured: boolean;
  envVar: string;
  /** Only ever exists / first 8 characters / length — never the secret. */
  key: EnvKeySummary;
  issue?: string;
  models: readonly string[];
}

export function getProviderConfigurationDiagnostics(): ProviderConfigurationDiagnostic[] {
  ensureServerEnvLoaded();
  return (["gemini", "openai", "openrouter"] as const).map((provider) => {
    const envVar = PROVIDER_CONFIG[provider].apiKeyEnv;
    const key = getProviderApiKey(provider);
    const validation = validateApiKey(key);
    return {
      provider,
      label: PROVIDER_LABELS[provider],
      configured: !!key && validation.valid,
      envVar,
      key: summarizeSecret(key, envVar),
      issue: key ? validation.issue : "missing",
      models: PROVIDER_CONFIG[provider].models,
    };
  });
}

/**
 * Startup diagnostics required by the runbook: for every provider print whether
 * it is configured, plus the safe key summary (exists / first 8 / length).
 */
export function logProviderConfigurationDiagnostics(
  logger?: Logger,
): ProviderConfigurationDiagnostic[] {
  const diagnostics = getProviderConfigurationDiagnostics();

  console.info("");
  console.info("==================================");
  console.info("LORD PROVIDER CONFIGURATION");
  console.info("==================================");
  for (const entry of diagnostics) {
    const state = entry.configured ? "configured" : "not configured";
    const detail = entry.key.exists
      ? `key exists=true first8=${entry.key.first8} length=${entry.key.length}`
      : `key exists=false (${entry.envVar} is not set)`;
    console.info(`${entry.label}: ${state} — ${detail}`);
    if (entry.key.exists && !entry.configured) {
      console.warn(`  ⚠ ${entry.envVar} is present but unusable: ${entry.issue}`);
    }
  }
  console.info("==================================");
  console.info("");

  logger?.info("lord_provider_configuration", {
    providers: diagnostics.map((entry) => ({
      provider: entry.provider,
      configured: entry.configured,
      envVar: entry.envVar,
      key: entry.key,
      issue: entry.issue,
    })),
    envKeys: getProviderEnvSummaries(),
  });

  return diagnostics;
}

function logDiagnosticsOnce() {
  if (diagnosticsLogged) return;
  diagnosticsLogged = true;
  console.info(
    JSON.stringify({
      event: "lord_diagnostics",
      ...getLordEnvironmentDiagnostics(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Instrumented fetch wrappers (per provider)
// ---------------------------------------------------------------------------

function mergeAbortSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  const abort = () => controller.abort();

  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}

function classifyFetchError(error: unknown): {
  kind: "network" | "abort" | "timeout" | "unknown";
  name: string;
  message: string;
  stack?: string;
} {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const lower = message.toLowerCase();

  if (name === "AbortError" || lower.includes("abort") || lower.includes("aborted")) {
    return { kind: "abort", name, message, stack };
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("deadline")) {
    return { kind: "timeout", name, message, stack };
  }
  if (name === "TypeError" || lower.includes("fetch failed") || lower.includes("network")) {
    return { kind: "network", name, message, stack };
  }
  return { kind: "unknown", name, message, stack };
}

// Read a header value case-insensitively from whatever shape `fetch` gives us.
function readHeader(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  }
  const record = headers as Record<string, string>;
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function summarizePayload(body?: BodyInit | null): Record<string, unknown> {
  if (!body || typeof body !== "string") return { hasBody: false };
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      model: parsed.model,
      stream: parsed.stream,
      messagesLength: Array.isArray(parsed.messages)
        ? (parsed.messages as unknown[]).length
        : undefined,
      temperature: parsed.temperature,
      max_tokens: parsed.max_tokens ?? parsed.max_completion_tokens,
    };
  } catch {
    return { parseError: "request body was not valid JSON" };
  }
}

// Verify the key the provider SDK actually put on the wire is byte-for-byte the
// key currently in process.env. A mismatch means the SDK captured a stale value
// (for example a provider instance built before the env was reloaded), which
// presents itself as an "invalid API key" error from a perfectly valid key.
function verifyWireKey(
  provider: ProviderName,
  logger: Logger,
  headers: { authorization?: string; googleApiKey?: string },
): { present: boolean; matchesProcessEnv: boolean; key: EnvKeySummary } {
  const bearer = headers.authorization?.startsWith("Bearer ")
    ? headers.authorization.slice("Bearer ".length)
    : undefined;
  const wireKey = headers.googleApiKey ?? bearer;
  const envKey = getProviderApiKey(provider);
  const envVar = PROVIDER_CONFIG[provider].apiKeyEnv;
  const matchesProcessEnv = !!wireKey && !!envKey && wireKey === envKey;

  if (wireKey && envKey && !matchesProcessEnv) {
    logger.error("ai_provider_key_mismatch", {
      provider,
      envVar,
      message: `The key sent to ${provider} differs from ${envVar} in process.env`,
      wireKey: summarizeSecret(wireKey, "wire"),
      envKey: summarizeSecret(envKey, envVar),
    });
  }

  return {
    present: !!wireKey,
    matchesProcessEnv,
    key: summarizeSecret(wireKey, envVar),
  };
}

// Create a provider-aware fetch wrapper. Logs structured events
// and throws `OpenRouterClientError` (the existing classification machinery
// understands it). The error carries the provider name so callers can record
// circuit-breaker / health state.
function makeProviderFetch(provider: ProviderName, timeoutMs: number, logger: Logger) {
  return async function providerFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    const authHeader = readHeader(init?.headers, "authorization");
    const xGoogKey = readHeader(init?.headers, "x-goog-api-key");
    const contentType = readHeader(init?.headers, "content-type");

    const keyCheck = verifyWireKey(provider, logger, {
      authorization: authHeader,
      googleApiKey: xGoogKey,
    });

    logger.debug("ai_provider_request", {
      provider,
      url,
      hasAuth: !!authHeader && authHeader.startsWith("Bearer "),
      hasGoogleKey: !!xGoogKey,
      // Safe key summary only: exists / first 8 characters / length.
      key: keyCheck.key,
      keyMatchesProcessEnv: keyCheck.matchesProcessEnv,
      contentType,
      payload: summarizePayload(init?.body as string | undefined),
    });

    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? mergeAbortSignals([init.signal, timeout]) : timeout;

    try {
      const response = await fetch(input, { ...init, signal });

      const responseHeaders: Record<string, string> = {};
      if (typeof response.headers?.entries === "function") {
        for (const [k, v] of response.headers.entries()) responseHeaders[k] = v;
      }
      const requestId = response.headers.get("x-request-id") ?? undefined;

      logger.info("ai_provider_response", {
        provider,
        url,
        status: response.status,
        statusText: response.statusText,
        requestId,
        headers: responseHeaders,
      });

      if (response.ok) {
        return response;
      }

      const bodyText = await response.text();
      logger.error("ai_provider_response_error", {
        provider,
        url,
        status: response.status,
        statusText: response.statusText,
        requestId,
        body: bodyText,
        key: keyCheck.key,
        keyMatchesProcessEnv: keyCheck.matchesProcessEnv,
      });

      // Auth rejections are logged explicitly (including Gemini's 400
      // API_KEY_INVALID) so the failing key is unambiguous in the logs — with
      // the safe summary only, never the secret itself.
      if (
        response.status === 401 ||
        response.status === 403 ||
        (response.status === 400 && isAuthFailureMessage(bodyText))
      ) {
        logger.error("ai_provider_auth_failed", {
          provider,
          envVar: PROVIDER_CONFIG[provider].apiKeyEnv,
          status: response.status,
          key: keyCheck.key,
          keyMatchesProcessEnv: keyCheck.matchesProcessEnv,
          hint: `${PROVIDER_CONFIG[provider].apiKeyEnv} was rejected by ${provider}. Fallback continues with the remaining providers.`,
        });
      }

      if (response.status === 429 || response.status === 404 || response.status >= 500) {
        logger.warn("ai_provider_recoverable_response", {
          provider,
          status: response.status,
          requestId,
        });
      }

      throw new OpenRouterClientError(
        `${provider} responded with ${response.status} ${response.statusText}`,
        { kind: "api", status: response.status, body: bodyText },
      );
    } catch (error) {
      const { kind, name, message, stack } = classifyFetchError(error);
      const effectiveKind = error instanceof OpenRouterClientError ? error.kind : kind;

      logger.error("ai_provider_network_error", {
        provider,
        url,
        kind: effectiveKind,
        name,
        message,
        stack,
      });

      if (error instanceof OpenRouterClientError) throw error;
      const structured = new OpenRouterClientError(
        `${provider} client ${effectiveKind}: ${message}`,
        { kind: effectiveKind === "unknown" ? "network" : effectiveKind },
      );
      (structured as unknown as { lordProvider?: string }).lordProvider = provider;
      throw structured;
    }
  };
}

// ---------------------------------------------------------------------------
// Provider parameter normalization
// ---------------------------------------------------------------------------

interface ProviderParamLimits {
  minOutputTokens: number;
  defaultTemperature: number;
  maxTemperature: number;
}

const PROVIDER_PARAM_LIMITS: Record<ProviderName, ProviderParamLimits> = {
  gemini: {
    minOutputTokens: 1,
    defaultTemperature: 0.7,
    maxTemperature: 2.0,
  },
  openrouter: {
    minOutputTokens: 1,
    defaultTemperature: 0.7,
    maxTemperature: 2.0,
  },
  openai: {
    minOutputTokens: 16,
    defaultTemperature: 0.7,
    maxTemperature: 2.0,
  },
};

export function normalizeProviderParams(
  provider: ProviderName,
  params: {
    maxOutputTokens?: number;
    temperature?: number;
  },
): {
  maxOutputTokens: number;
  temperature: number;
} {
  const limits = PROVIDER_PARAM_LIMITS[provider];
  const maxOutputTokens = Math.max(params.maxOutputTokens ?? 1024, limits.minOutputTokens);
  const temperature = Math.min(
    Math.max(params.temperature ?? limits.defaultTemperature, 0),
    limits.maxTemperature,
  );
  return { maxOutputTokens, temperature };
}

// ---------------------------------------------------------------------------
// Provider factories
// ---------------------------------------------------------------------------

interface LordProviders {
  gemini: ReturnType<typeof createGoogleGenerativeAI> | null;
  openrouter: ReturnType<typeof createOpenAICompatible> | null;
  openai: ReturnType<typeof createOpenAI> | null;
}

interface LordProviderMeta {
  timeoutMs: number;
  hasKey: boolean;
}

export interface LordProvidersState {
  providers: LordProviders;
  meta: Record<ProviderName, LordProviderMeta>;
}

// Lazily construct each provider only if its key is present. Missing keys are
// graceful: the provider stays `null` and candidates for it are skipped during
// routing, so LORD continues using whichever providers are configured.
//
// Keys are read through `getProviderApiKey`, which loads the env files if this
// process has not done so yet and normalizes the value (surrounding quotes and
// stray whitespace are stripped) so the SDK receives exactly the value that is
// in `process.env`.
export function createLordProviders(logger: Logger): LordProvidersState {
  ensureServerEnvLoaded();
  logDiagnosticsOnce();

  const geminiKey = getProviderApiKey("gemini");
  const openRouterKey = getProviderApiKey("openrouter");
  const openaiKey = getProviderApiKey("openai");

  const providers: LordProviders = {
    gemini: null,
    openrouter: null,
    openai: null,
  };

  const meta: Record<ProviderName, LordProviderMeta> = {
    gemini: {
      timeoutMs: GATEWAY_CONFIG.providerTimeouts.gemini,
      hasKey: !!geminiKey && validateApiKey(geminiKey).valid,
    },
    openrouter: {
      timeoutMs: GATEWAY_CONFIG.providerTimeouts.openrouter,
      hasKey: !!openRouterKey && validateApiKey(openRouterKey).valid,
    },
    openai: {
      timeoutMs: GATEWAY_CONFIG.providerTimeouts.openai,
      hasKey: !!openaiKey && validateApiKey(openaiKey).valid,
    },
  };

  if (geminiKey) {
    const validation = validateApiKey(geminiKey);
    if (!validation.valid) {
      logger.error("ai_provider_invalid_key", {
        provider: "gemini",
        envVar: "GEMINI_API_KEY",
        issue: validation.issue,
        key: summarizeApiKey(geminiKey),
      });
    } else {
      logger.info("ai_provider_sdk_configured", {
        provider: "gemini",
        source: "process.env.GEMINI_API_KEY",
        key: summarizeApiKey(geminiKey),
        sameAsProcessEnv: geminiKey === readEnvApiKey("GEMINI_API_KEY"),
      });
      providers.gemini = createGoogleGenerativeAI({
        // Read per request from process.env so a reloaded key takes effect
        // without rebuilding the provider from a stale captured value.
        apiKey: geminiKey,
        fetch: makeProviderFetch("gemini", GATEWAY_CONFIG.providerTimeouts.gemini, logger),
      });
    }
  }

  if (openRouterKey) {
    const validation = validateApiKey(openRouterKey);
    if (!validation.valid) {
      logger.error("ai_provider_invalid_key", {
        provider: "openrouter",
        envVar: "OPENROUTER_API_KEY",
        issue: validation.issue,
        key: summarizeApiKey(openRouterKey),
      });
    } else {
      logger.info("ai_provider_sdk_configured", {
        provider: "openrouter",
        source: "process.env.OPENROUTER_API_KEY",
        key: summarizeApiKey(openRouterKey),
        sameAsProcessEnv: openRouterKey === readEnvApiKey("OPENROUTER_API_KEY"),
      });
      providers.openrouter = createOpenAICompatible({
        name: "openrouter",
        baseURL: OPENROUTER_BASE_URL,
        apiKey: openRouterKey,
        headers: {
          "HTTP-Referer": OPENROUTER_REFERER,
          "X-Title": OPENROUTER_TITLE,
        },
        fetch: makeProviderFetch("openrouter", GATEWAY_CONFIG.providerTimeouts.openrouter, logger),
        includeUsage: true,
      });
    }
  }

  if (openaiKey) {
    const validation = validateApiKey(openaiKey);
    if (!validation.valid) {
      logger.error("ai_provider_invalid_key", {
        provider: "openai",
        envVar: "OPENAI_API_KEY",
        issue: validation.issue,
        key: summarizeApiKey(openaiKey),
      });
    } else {
      logger.info("ai_provider_sdk_configured", {
        provider: "openai",
        source: "process.env.OPENAI_API_KEY",
        key: summarizeApiKey(openaiKey),
        sameAsProcessEnv: openaiKey === readEnvApiKey("OPENAI_API_KEY"),
      });
      providers.openai = createOpenAI({
        apiKey: openaiKey,
        fetch: makeProviderFetch("openai", GATEWAY_CONFIG.providerTimeouts.openai, logger),
      });
    }
  }

  return { providers, meta };
}

// Backwards-compatible: create a single OpenRouter provider from a key. Still
// exported for any callers/tests that relied on it; the multi-provider path
// prefers `createLordProviders` + `createLordGateway`.
export function createOpenRouterProvider(apiKey: string, logger: Logger) {
  const validation = validateApiKey(apiKey);
  if (!validation.valid) {
    logger.error("openrouter_invalid_api_key", { issue: validation.issue });
    throw new OpenRouterClientError(`Invalid OPENROUTER_API_KEY: ${validation.issue}`, {
      kind: "api",
      status: 401,
    });
  }

  logDiagnosticsOnce();

  return createOpenAICompatible({
    name: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    headers: {
      "HTTP-Referer": OPENROUTER_REFERER,
      "X-Title": OPENROUTER_TITLE,
    },
    fetch: makeProviderFetch("openrouter", GATEWAY_CONFIG.providerTimeoutDefaultMs, logger),
    includeUsage: true,
  });
}

// Return the list of providers that have valid keys configured, in stable order.
export function getConfiguredProviders(): ProviderName[] {
  ensureServerEnvLoaded();
  return (["gemini", "openrouter", "openai"] as const).filter((p) => {
    const value = getProviderApiKey(p);
    return !!value && validateApiKey(value).valid;
  });
}

// ---------------------------------------------------------------------------
// Gateway infrastructure (health cache, circuit breaker, model stats)
// ---------------------------------------------------------------------------

export interface GatewayInfrastructure {
  healthCache: HealthCache;
  circuitBreaker: CircuitBreaker;
  modelStats: ModelStatsStore;
  logger: Logger;
}

let sharedInfrastructure: GatewayInfrastructure | null = null;

export function getGatewayInfrastructure(logger?: Logger): GatewayInfrastructure {
  if (!sharedInfrastructure) {
    const resolvedLogger = logger ?? createLogger(GATEWAY_CONFIG);
    sharedInfrastructure = {
      healthCache: createHealthCache({
        defaultTtlMs: GATEWAY_CONFIG.healthCacheDefaultTtlMs,
        ttlByStatus: GATEWAY_CONFIG.healthCacheTtlByStatus,
      }),
      circuitBreaker: createCircuitBreaker({
        failureThreshold: GATEWAY_CONFIG.cbFailureThreshold,
        recoveryMs: GATEWAY_CONFIG.cbRecoveryMs,
        halfOpenSuccessThreshold: GATEWAY_CONFIG.cbHalfOpenSuccessThreshold,
      }),
      modelStats: createModelStatsStore({
        maxSamples: GATEWAY_CONFIG.modelStatsMaxSamples,
      }),
      logger: resolvedLogger,
    };
  }
  return sharedInfrastructure;
}

export function resetGatewayInfrastructure(): void {
  sharedInfrastructure = null;
}

// ---------------------------------------------------------------------------
// Model probe cache (module-level, shared across requests in the same process)
// ---------------------------------------------------------------------------
// Caches the first-working candidate per `mode` so we skip re-probing on every
// request. Positive results are cached for PROBE_CACHE_TTL_MS; a failure
// immediately invalidates the entry so we don't blindly stream to a dead model.

interface ProbeCacheEntry {
  provider: ProviderName;
  model: string;
  ts: number;
}

const probeCache = new Map<string, ProbeCacheEntry>();

function getCachedCandidate(mode: string): ProbeCacheEntry | null {
  const entry = probeCache.get(mode);
  if (!entry) return null;
  if (Date.now() - entry.ts > GATEWAY_CONFIG.probeCacheTtlMs) {
    probeCache.delete(mode);
    return null;
  }
  return entry;
}

function setCachedCandidate(mode: string, entry: ProbeCacheEntry): void {
  probeCache.set(mode, entry);
}

function invalidateCachedCandidate(mode: string): void {
  probeCache.delete(mode);
}

// Exponential backoff retry for transient probe/stream errors. Returns the
// delay (ms) before the next retry attempt, or 0 if no more retries remain.
function probeBackoff(attempt: number, maxAttempts: number): number {
  if (attempt >= maxAttempts) return 0;
  return Math.min(
    GATEWAY_CONFIG.retryBackoffBaseMs * GATEWAY_CONFIG.retryBackoffMultiplier ** attempt,
    GATEWAY_CONFIG.retryBackoffMaxMs,
  );
}

// ---------------------------------------------------------------------------
// Startup validation
// ---------------------------------------------------------------------------

export interface StartupValidationResult {
  provider: string;
  healthy: string[];
  unhealthy: Array<{ model: string; reason: string; status?: string }>;
  disabledModels: Array<{ model: string; reason: string; disabledUntil: number }>;
}

export async function validateProvidersAtStartup(
  state: LordProvidersState,
  infra: GatewayInfrastructure,
): Promise<StartupValidationResult[]> {
  const results: StartupValidationResult[] = [];
  const providerOrder: Array<{ name: string; provider: ProviderName }> = [
    { name: "Gemini", provider: "gemini" },
    { name: "OpenRouter", provider: "openrouter" },
    { name: "OpenAI", provider: "openai" },
  ];

  for (const { name, provider } of providerOrder) {
    const prov = state.providers[provider];
    const healthy: string[] = [];
    const unhealthy: Array<{ model: string; reason: string; status?: string }> = [];
    const disabledModels: Array<{ model: string; reason: string; disabledUntil: number }> = [];

    if (!prov) {
      const models = PROVIDER_CONFIG[provider].models;
      for (const modelId of models) {
        unhealthy.push({ model: modelId, reason: "Provider not configured (missing API key)" });
      }
      results.push({ provider: name, healthy, unhealthy, disabledModels });
      continue;
    }

    const models = PROVIDER_CONFIG[provider].models;
    for (const modelId of models) {
      const existingEntry = infra.healthCache.get(provider, modelId);
      if (existingEntry && existingEntry.status !== "healthy") {
        disabledModels.push({
          model: modelId,
          reason: existingEntry.reason,
          disabledUntil: existingEntry.expiresAt,
        });
        continue;
      }

      try {
        await generateText({
          model: prov(modelId),
          system: "Reply with OK",
          messages: [{ role: "user", content: "OK" }],
          maxOutputTokens:
            GATEWAY_CONFIG.probeMaxOutputTokensByProvider[provider] ??
            GATEWAY_CONFIG.probeMaxOutputTokens,
          temperature: 0,
          maxRetries: 0,
          timeout: GATEWAY_CONFIG.startupValidationTimeoutMs,
        });
        healthy.push(modelId);
        infra.healthCache.set({
          provider,
          model: modelId,
          status: "healthy",
          reason: "",
          timestamp: Date.now(),
          expiresAt: Date.now() + GATEWAY_CONFIG.healthCacheDefaultTtlMs,
        });
        infra.circuitBreaker.recordSuccess(provider, modelId);
      } catch (err) {
        const classification = classifyModelError(err);
        const reasonLabel =
          GATEWAY_CONFIG.errorReasonLabels[classification.reason] ?? classification.reason;
        const statusStr =
          classification.status !== undefined ? String(classification.status) : undefined;
        unhealthy.push({ model: modelId, reason: reasonLabel, status: statusStr });
        if (classification.retryable) {
          disabledModels.push({
            model: modelId,
            reason: reasonLabel,
            disabledUntil:
              Date.now() + infra.healthCache.getTtlForStatus(classification.status ?? "unknown"),
          });
        }
        infra.healthCache.set({
          provider,
          model: modelId,
          status: classification.retryable ? "unavailable" : "invalid",
          reason: reasonLabel,
          timestamp: Date.now(),
          expiresAt:
            Date.now() + infra.healthCache.getTtlForStatus(classification.status ?? "unknown"),
          httpStatus: classification.status,
          retryable: classification.retryable,
        });
        infra.circuitBreaker.recordFailure(provider, modelId);
      }
    }

    results.push({ provider: name, healthy, unhealthy, disabledModels });
  }

  return results;
}

export function logStartupBanner(
  state: LordProvidersState,
  infra: GatewayInfrastructure,
  configuredProviders: ProviderName[],
) {
  const enabledModels: Record<ProviderName, string[]> = { gemini: [], openrouter: [], openai: [] };
  const disabledModels: Record<ProviderName, string[]> = { gemini: [], openrouter: [], openai: [] };

  for (const provider of configuredProviders) {
    const models = PROVIDER_CONFIG[provider].models;
    const enabled: string[] = [];
    const disabled: string[] = [];
    for (const modelId of models) {
      const health = infra.healthCache.get(provider, modelId);
      const circuitOpen = infra.circuitBreaker.isOpen(provider, modelId);
      if (health && health.status !== "healthy") {
        disabled.push(modelId);
      } else if (circuitOpen) {
        disabled.push(modelId + " (open circuit)");
      } else {
        enabled.push(modelId);
      }
    }
    enabledModels[provider] = enabled;
    disabledModels[provider] = disabled;
  }

  const preferredModels: Record<string, string> = {};
  for (const mode of Object.keys(LORD_MODELS) as LordMode[]) {
    const cached = getCachedCandidate(mode);
    if (cached) {
      preferredModels[mode] = `${cached.provider}/${cached.model}`;
    }
  }

  infra.logger.startupBanner({
    configuredProviders,
    enabledModels,
    disabledModels,
    healthCacheEntries: infra.healthCache.getAll().length,
    circuitBreakerEntries: infra.circuitBreaker.getAll().length,
    preferredModels,
  });
  // Image generation runs exclusively on Cloudflare Workers AI; its health is
  // reported separately at startup by the image pipeline (see ensureImageHealth).
  infra.logger.info("lord_active_image_configuration", { imageProvider: "cloudflare" });
}

// ---------------------------------------------------------------------------
// Core gateway logic
// ---------------------------------------------------------------------------

export type LordModelGateway = (candidate: Candidate) => LanguageModel;

// Build a gateway that resolves any Candidate to the matching provider
// instance from the configured state. Throws when the candidate's provider is
// not configured (missing/invalid key) so the caller can fall back.
export function createLordGateway(state: LordProvidersState): LordModelGateway {
  return (candidate: Candidate): LanguageModel => {
    const prov = state.providers[candidate.provider];
    if (!prov) {
      throw new OpenRouterClientError(
        `${candidate.provider} is not configured (missing or invalid API key)`,
        {
          kind: "api",
          status: 401,
          body: JSON.stringify({ provider: candidate.provider, modelId: candidate.modelId }),
        },
      );
    }
    return prov(candidate.modelId);
  };
}

export interface StreamWithFallbackOptions {
  gateway: LordModelGateway;
  state: LordProvidersState;
  mode: LordMode;
  explicitModelId?: string;
  system: string;
  messages: ModelMessage[];
  requestId: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onTokenUsage?: (event: TokenUsageEvent) => void;
}

export interface StreamWithFallbackResult {
  result: Awaited<ReturnType<typeof streamText>>;
  model: string;
  provider: ProviderName;
  attempts: ModelAttempt[];
  /** Milliseconds from streamText call until first chunk arrives (TTFT). */
  ttftMs: number;
  /** Milliseconds from first chunk until stream end. */
  streamMs: number;
}

function logGateway(logger: Logger, event: string, payload: Record<string, unknown>) {
  logger.info(event, payload);
}

// Get the retry policy for a given error classification.
function getRetryPolicy(classification: ModelErrorClassification) {
  const statusKey =
    classification.status !== undefined ? String(classification.status) : classification.reason;
  return (
    GATEWAY_CONFIG.retryPolicy[statusKey] ?? {
      retryable: classification.retryable,
      maxRetries: classification.retryable ? GATEWAY_CONFIG.maxRetriesDefault : 0,
    }
  );
}

const candidateKey = (candidate: Candidate) => `${candidate.provider}:${candidate.modelId}`;

/**
 * Error thrown when routing is exhausted. It carries which providers were
 * actually contacted so the caller can only report "All configured models
 * failed" when every configured provider really was attempted.
 */
export class AllProvidersFailedError extends Error {
  readonly lordAttempts: ModelAttempt[];
  readonly configuredProviders: ProviderName[];
  readonly attemptedProviders: ProviderName[];
  readonly notAttemptedProviders: ProviderName[];
  readonly allProvidersAttempted: boolean;
  readonly providerStatuses: ProviderStatus[];

  constructor(
    message: string,
    info: {
      attempts: ModelAttempt[];
      configuredProviders: ProviderName[];
      attemptedProviders: ProviderName[];
      providerStatuses: ProviderStatus[];
    },
  ) {
    super(message);
    this.name = "AllProvidersFailedError";
    this.lordAttempts = info.attempts;
    this.configuredProviders = info.configuredProviders;
    this.attemptedProviders = info.attemptedProviders;
    this.notAttemptedProviders = info.configuredProviders.filter(
      (p) => !info.attemptedProviders.includes(p),
    );
    this.allProvidersAttempted = this.notAttemptedProviders.length === 0;
    this.providerStatuses = info.providerStatuses;
  }
}

// Build the ordered routing plan for a request.
//
// The mode's own candidate order is preserved (and still sorted by dynamic
// routing stats) so normal routing behaviour is unchanged. Two guarantees are
// added on top:
//   1. every configured provider is represented, by appending its remaining
//      models after the mode list — a provider is never skipped just because
//      the single model it contributes to this mode is unavailable;
//   2. candidates that are currently unhealthy or circuit-broken are deferred
//      to the end instead of being dropped, so "all providers failed" can only
//      be reported after each provider has genuinely been contacted.
function buildRoutingPlan(
  opts: StreamWithFallbackOptions,
  infra: GatewayInfrastructure,
): { plan: Candidate[]; deferred: Set<string>; configuredProviders: ProviderName[] } {
  const { mode, state } = opts;
  const resolvedExplicit = opts.explicitModelId ? resolveCandidate(opts.explicitModelId) : null;
  const hasKey = (provider: ProviderName) => !!state.meta[provider]?.hasKey;

  const modeCandidates = getModeCandidates(
    mode,
    resolvedExplicit ? undefined : opts.explicitModelId,
    resolvedExplicit?.provider,
    resolvedExplicit?.modelId,
  ).filter((c) => hasKey(c.provider));

  // Dynamic routing: sort the mode's candidates by health and performance.
  if (GATEWAY_CONFIG.dynamicRoutingEnabled && !opts.explicitModelId) {
    modeCandidates.sort((a, b) => {
      const statsA = infra.modelStats.getStats(a.provider, a.modelId);
      const statsB = infra.modelStats.getStats(b.provider, b.modelId);
      const failureRateA = statsA.requests > 0 ? statsA.failures / statsA.requests : 0;
      const failureRateB = statsB.requests > 0 ? statsB.failures / statsB.requests : 0;
      const avgTTFTA = statsA.successes > 0 ? statsA.totalTTFTMs / statsA.successes : Infinity;
      const avgTTFTB = statsB.successes > 0 ? statsB.totalTTFTMs / statsB.successes : Infinity;

      if (failureRateA !== failureRateB) return failureRateA - failureRateB;
      if (avgTTFTA !== avgTTFTB) return avgTTFTA - avgTTFTB;
      return 0;
    });
  }

  const configuredProviders = (["gemini", "openrouter", "openai"] as const).filter(hasKey);

  const seen = new Set(modeCandidates.map(candidateKey));
  const providerCompletion: Candidate[] = [];
  for (const provider of configuredProviders) {
    for (const modelId of PROVIDER_CONFIG[provider].models) {
      const candidate: Candidate = { provider, modelId };
      if (seen.has(candidateKey(candidate))) continue;
      seen.add(candidateKey(candidate));
      providerCompletion.push(candidate);
    }
  }

  const ordered = [...modeCandidates, ...providerCompletion];
  const usable: Candidate[] = [];
  const deferredCandidates: Candidate[] = [];
  const deferred = new Set<string>();

  for (const candidate of ordered) {
    const circuitOpen = infra.circuitBreaker.isOpen(candidate.provider, candidate.modelId);
    const healthy = infra.healthCache.isHealthy(candidate.provider, candidate.modelId);
    if (circuitOpen || !healthy) {
      deferredCandidates.push(candidate);
      deferred.add(candidateKey(candidate));
    } else {
      usable.push(candidate);
    }
  }

  return { plan: [...usable, ...deferredCandidates], deferred, configuredProviders };
}

function buildProviderStatuses(
  configuredProviders: ProviderName[],
  attempts: Map<ProviderName, ModelAttempt[]>,
): ProviderStatus[] {
  return configuredProviders.map((provider) => {
    const providerAttempts = attempts.get(provider) ?? [];
    const label = PROVIDER_LABELS[provider];
    if (providerAttempts.length === 0) {
      return { provider: label, status: "unavailable" as const };
    }
    const last = providerAttempts[providerAttempts.length - 1];
    if (last.reason === GATEWAY_CONFIG.errorReasonLabels.invalid_api_key) {
      return { provider: label, status: "invalid" as const };
    }
    if (last.reason === GATEWAY_CONFIG.errorReasonLabels.missing_api_key) {
      return { provider: label, status: "missing_api_key" as const };
    }
    if (last.reason === GATEWAY_CONFIG.errorReasonLabels.rate_limit) {
      return { provider: label, status: "rate_limited" as const };
    }
    return { provider: label, status: "unavailable" as const };
  });
}

// Tries each candidate model for `mode` in order. A candidate is validated with
// a cheap pre-flight call; on failure its error is classified:
//   - retryable  -> log and move to the next candidate
//   - non-retryable -> skip the model and move to the next candidate
//   - authentication failure -> disable that provider for the rest of this
//     request (its remaining models cannot succeed with a rejected key) and
//     continue with the next provider
// The first candidate that passes the probe is returned so the caller can
// either stream it or complete it. Throws `AllProvidersFailedError` only after
// every configured provider has actually been attempted.
export async function findFirstWorkingModel(opts: StreamWithFallbackOptions): Promise<{
  candidate: Candidate;
  provider: ProviderName;
  attempts: ModelAttempt[];
  probeMs: number;
}> {
  const { mode, requestId, state } = opts;
  const infra = getGatewayInfrastructure();
  const logger = infra.logger;
  const { plan, deferred, configuredProviders } = buildRoutingPlan(opts, infra);
  const candidates = plan;

  const modeLabel = LORD_MODE_LABELS[mode];
  const probeStart = performance.now();

  // Fast-path: if we have a fresh cache hit for this mode and its provider is
  // still healthy + configured, use it directly (unless an explicit modelId was
  // requested, in which case we must probe it).
  const cached = opts.explicitModelId ? null : getCachedCandidate(mode);
  if (cached && !opts.explicitModelId) {
    const stillConfigured =
      state.meta[cached.provider]?.hasKey &&
      !infra.circuitBreaker.isOpen(cached.provider, cached.model) &&
      infra.healthCache.isHealthy(cached.provider, cached.model);
    if (stillConfigured) {
      logGateway(logger, "ai_probe_cache_hit", {
        requestId,
        mode,
        provider: cached.provider,
        model: cached.model,
      });
      return {
        candidate: { provider: cached.provider, modelId: cached.model },
        provider: cached.provider,
        attempts: [],
        probeMs: 0,
      };
    }
    invalidateCachedCandidate(mode);
  }

  logger.info("ai_mode", { mode: modeLabel });

  const attempts: ModelAttempt[] = [];
  const attemptsByProvider = new Map<ProviderName, ModelAttempt[]>();
  const attemptedProviders: ProviderName[] = [];
  // Providers whose credentials were rejected during THIS request. Their
  // remaining models cannot succeed with a rejected key, so they are skipped
  // immediately and routing continues with the next provider.
  const authDisabledProviders = new Set<ProviderName>();

  const recordAttempt = (provider: ProviderName, attempt: ModelAttempt) => {
    attempts.push(attempt);
    const list = attemptsByProvider.get(provider) ?? [];
    list.push(attempt);
    attemptsByProvider.set(provider, list);
  };
  const markAttempted = (provider: ProviderName) => {
    if (!attemptedProviders.includes(provider)) attemptedProviders.push(provider);
  };

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const { provider, modelId } = candidate;
    const attemptNum = i + 1;

    // Provider already failed authentication in this request: skip the rest of
    // its models straight away (task 5 / task 6) and continue with the next
    // provider instead of burning another round trip on a rejected key.
    if (authDisabledProviders.has(provider)) {
      logger.info("ai_provider_skipped_auth_disabled", {
        requestId,
        mode,
        provider,
        model: modelId,
        reason: "Provider disabled for this request after an authentication failure",
      });
      continue;
    }

    logger.info("Attempt " + attemptNum + ":\n" + provider + ":" + modelId, {
      requestId,
      mode,
      attempt: attemptNum,
      provider,
      model: modelId,
    });
    logGateway(logger, "ai_provider_selected", {
      requestId,
      mode,
      attempt: attemptNum,
      provider,
      model: modelId,
      // Deferred candidates are the ones a health/circuit check had previously
      // parked; they are still attempted so no provider is silently skipped.
      deferred: deferred.has(candidateKey(candidate)),
    });

    // Skip candidates whose provider has no valid key configured.
    if (!state.meta[provider]?.hasKey) {
      recordAttempt(provider, {
        model: modelId,
        status: 0,
        reason: GATEWAY_CONFIG.errorReasonLabels.missing_api_key,
        retryable: false,
        providerMessage: `Provider "${provider}" has no valid API key`,
        timestamp: Date.now(),
      });
      continue;
    }

    markAttempted(provider);

    // Exponential retry for transient probe failures: a provider may be
    // flapping, so we retry a couple of times before giving up on it.
    const maxProbeAttempts = GATEWAY_CONFIG.probeMaxAttempts;
    let probed = false;
    for (let probeTry = 0; probeTry < maxProbeAttempts && !probed; probeTry++) {
      try {
        await generateText({
          model: opts.gateway(candidate),
          system: "Reply with OK",
          messages: [{ role: "user", content: "OK" }],
          maxOutputTokens:
            GATEWAY_CONFIG.probeMaxOutputTokensByProvider[provider] ??
            GATEWAY_CONFIG.probeMaxOutputTokens,
          temperature: 0,
          maxRetries: 0,
          timeout: GATEWAY_CONFIG.probeTimeoutMs,
          abortSignal: opts.abortSignal,
        });
        probed = true;
      } catch (err) {
        const classification = classifyModelError(err);
        const errProvider: ProviderName =
          err instanceof OpenRouterClientError
            ? (((err as unknown as { lordProvider?: string }).lordProvider ??
                provider) as ProviderName)
            : provider;
        const attempt: ModelAttempt = {
          model: modelId,
          status: classification.status ?? 0,
          reason: GATEWAY_CONFIG.errorReasonLabels[classification.reason] ?? classification.reason,
          retryable: classification.retryable,
          providerMessage: classification.providerMessage,
          errorCode: classification.errorCode,
          requestId: classification.requestId,
          timestamp: Date.now(),
        };
        recordAttempt(provider, attempt);
        logger.info(
          "Failed:\n" +
            attempt.reason +
            " (status: " +
            attempt.status +
            ", retryable: " +
            attempt.retryable +
            ")",
          {
            requestId,
            provider,
            model: modelId,
            reason: attempt.reason,
            status: attempt.status,
            retryable: attempt.retryable,
          },
        );

        // Record circuit-breaker / health state for the failing provider/model.
        infra.circuitBreaker.recordFailure(errProvider, modelId);
        infra.healthCache.set({
          provider: errProvider,
          model: modelId,
          status: classification.retryable ? "unavailable" : "invalid",
          reason: attempt.reason,
          timestamp: Date.now(),
          expiresAt:
            Date.now() + infra.healthCache.getTtlForStatus(classification.status ?? "unknown"),
          httpStatus: classification.status,
          retryable: classification.retryable,
        });
        infra.modelStats.record(errProvider, modelId, {
          success: false,
          ttftMs: 0,
          streamMs: 0,
          reason: attempt.reason,
        });

        // Authentication failure (401/403, or Gemini's 400 API_KEY_INVALID):
        // the key itself was rejected, so every other model of this provider
        // would fail the same way. Disable the provider for the remainder of
        // this request and continue with the next configured provider.
        if (isAuthFailure(classification)) {
          authDisabledProviders.add(errProvider);
          logger.error("ai_provider_auth_disabled", {
            requestId,
            mode,
            provider: errProvider,
            envVar: PROVIDER_CONFIG[errProvider].apiKeyEnv,
            status: classification.status,
            reason: attempt.reason,
            providerMessage: classification.providerMessage,
            message: `${PROVIDER_LABELS[errProvider]} authentication failed — disabled for this request, continuing with the remaining providers.`,
          });
          break;
        }

        if (!classification.retryable) {
          // Non-retryable (e.g. unsupported request) for THIS model — move on
          // to the next candidate rather than aborting the whole request.
          logger.warn("Skipping invalid model " + modelId + ": " + classification.providerMessage, {
            requestId,
            provider,
            model: modelId,
          });
          break;
        }

        // Retryable: check retry policy and back off briefly if retries remain.
        const policy = getRetryPolicy(classification);
        if (probeTry < policy.maxRetries - 1) {
          const delay = probeBackoff(probeTry, maxProbeAttempts);
          if (delay > 0) {
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        // No retries left: fall through to the next candidate.
        break;
      }
    }

    if (probed) {
      // Success: cache this candidate as the preferred choice for this mode.
      setCachedCandidate(mode, { provider, model: modelId, ts: Date.now() });
      infra.circuitBreaker.recordSuccess(provider, modelId);
      infra.healthCache.set({
        provider,
        model: modelId,
        status: "healthy",
        reason: "",
        timestamp: Date.now(),
        expiresAt: Date.now() + GATEWAY_CONFIG.healthCacheDefaultTtlMs,
      });
      infra.modelStats.record(provider, modelId, {
        success: true,
        ttftMs: 0,
        streamMs: 0,
      });
      logger.info("Success", {
        requestId,
        mode,
        provider,
        model: modelId,
      });
      const probeMs = Math.round(performance.now() - probeStart);
      logGateway(logger, "ai_probe_complete", {
        requestId,
        mode,
        provider,
        model: modelId,
        probeMs,
        attempts: attempts.length,
      });
      return { candidate, provider, attempts, probeMs };
    }
  }

  // All probes failed: invalidate any stale cache entry for this mode so the
  // next request starts fresh instead of blindly streaming to a dead model.
  invalidateCachedCandidate(mode);
  const probeMs = Math.round(performance.now() - probeStart);
  const notAttemptedProviders = configuredProviders.filter((p) => !attemptedProviders.includes(p));
  const providerStatuses = buildProviderStatuses(configuredProviders, attemptsByProvider);

  logger.error("lord_mode_exhausted", {
    requestId,
    mode,
    configuredProviders,
    attemptedProviders,
    notAttemptedProviders,
    authDisabledProviders: [...authDisabledProviders],
    allProvidersAttempted: notAttemptedProviders.length === 0,
    providerStatuses,
    attempts,
    probeMs,
  });

  // The message distinguishes a genuine exhaustion (every configured provider
  // was contacted) from an early exit — the caller must not report
  // "All configured models failed" unless the former is true.
  const message =
    notAttemptedProviders.length === 0
      ? `All configured providers failed for mode "${mode}" (attempted: ${attemptedProviders.join(", ") || "none"}).`
      : `Routing for mode "${mode}" ended before every configured provider was attempted (attempted: ${attemptedProviders.join(", ") || "none"}; not attempted: ${notAttemptedProviders.join(", ")}).`;

  throw new AllProvidersFailedError(message, {
    attempts,
    configuredProviders,
    attemptedProviders,
    providerStatuses,
  });
}

export async function streamWithFallback(
  opts: StreamWithFallbackOptions,
): Promise<StreamWithFallbackResult> {
  const { mode, requestId, state } = opts;
  const infra = getGatewayInfrastructure();
  const logger = infra.logger;
  const { candidate, provider, attempts, probeMs } = await findFirstWorkingModel(opts);
  const modelId = candidate.modelId;

  let firstChunkLogged = false;
  let tokensEmitted = 0;
  const streamStart = performance.now();
  let firstChunkTime = 0;
  let streamEndTime = 0;
  let streamError: Error | null = null;

  const providerTimeout =
    state.meta[provider]?.timeoutMs ?? GATEWAY_CONFIG.providerTimeoutDefaultMs;

  const normalizedParams = normalizeProviderParams(provider, {
    maxOutputTokens: opts.maxOutputTokens,
    temperature: opts.temperature,
  });

  const result = streamText({
    model: opts.gateway(candidate),
    system: opts.system,
    messages: opts.messages,
    maxOutputTokens: normalizedParams.maxOutputTokens,
    temperature: normalizedParams.temperature,
    maxRetries: GATEWAY_CONFIG.maxRetriesDefault,
    timeout: opts.timeoutMs ?? providerTimeout,
    abortSignal: opts.abortSignal,
    experimental_onStart: () => {
      logGateway(logger, "ai_stream_start", {
        requestId,
        mode,
        provider,
        model: modelId,
        probeMs,
      });
    },
    onChunk: ({ chunk }) => {
      if (!firstChunkLogged && chunk.type === "text-delta") {
        firstChunkLogged = true;
        firstChunkTime = performance.now();
        const ttft = Math.round(firstChunkTime - streamStart);
        logGateway(logger, "ai_stream_first_chunk", {
          requestId,
          mode,
          provider,
          model: modelId,
          ttftMs: ttft,
          probeMs,
        });
      }
      if (chunk.type === "text-delta") {
        tokensEmitted += 1;
      }
    },
    onError: ({ error }) => {
      const errProvider: ProviderName =
        error instanceof OpenRouterClientError
          ? (((error as unknown as { lordProvider?: string }).lordProvider ??
              provider) as ProviderName)
          : provider;
      infra.circuitBreaker.recordFailure(errProvider, modelId);
      const classification = classifyModelError(error);
      infra.healthCache.set({
        provider: errProvider,
        model: modelId,
        status: classification.retryable ? "unavailable" : "invalid",
        reason: GATEWAY_CONFIG.errorReasonLabels[classification.reason] ?? classification.reason,
        timestamp: Date.now(),
        expiresAt:
          Date.now() + infra.healthCache.getTtlForStatus(classification.status ?? "unknown"),
        httpStatus: classification.status,
        retryable: classification.retryable,
      });
      infra.modelStats.record(errProvider, modelId, {
        success: false,
        ttftMs: firstChunkTime > 0 ? Math.round(firstChunkTime - streamStart) : 0,
        streamMs: 0,
        reason: GATEWAY_CONFIG.errorReasonLabels[classification.reason] ?? classification.reason,
      });
      logger.error("ai_stream_error", {
        requestId,
        mode,
        provider,
        model: modelId,
        error: error instanceof Error ? error.message : String(error),
      });
      streamError = error instanceof Error ? error : new Error(String(error));
    },
    onFinish: ({ finishReason, usage }) => {
      streamEndTime = performance.now();
      const ttftMs = firstChunkTime > 0 ? Math.round(firstChunkTime - streamStart) : 0;
      const streamMs = firstChunkTime > 0 ? Math.round(streamEndTime - firstChunkTime) : 0;
      const cost = estimateCost(modelId, usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      infra.circuitBreaker.recordSuccess(provider, modelId);
      infra.healthCache.set({
        provider,
        model: modelId,
        status: "healthy",
        reason: "",
        timestamp: Date.now(),
        expiresAt: Date.now() + GATEWAY_CONFIG.healthCacheDefaultTtlMs,
      });
      infra.modelStats.record(provider, modelId, {
        success: true,
        ttftMs,
        streamMs,
      });
      logGateway(logger, "ai_stream_end", {
        requestId,
        mode,
        provider,
        model: modelId,
        finishReason,
        probeMs,
        ttftMs,
        streamMs,
        usage: {
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          totalTokens: usage.totalTokens ?? 0,
          reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
          cost,
        },
      });
      opts.onTokenUsage?.({
        requestId,
        model: modelId,
        mode,
        finishReason,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cost,
        timestamp: Date.now(),
      });
    },
  });

  const ttftMs = firstChunkTime > 0 ? Math.round(firstChunkTime - streamStart) : 0;
  const finalStreamMs =
    firstChunkTime > 0 ? Math.round((streamEndTime || performance.now()) - firstChunkTime) : 0;

  // If the stream errored before emitting any tokens, treat as a failed probe
  // so the caller can retry with another provider.
  if (streamError && tokensEmitted === 0 && GATEWAY_CONFIG.streamingRetryIfNoTokens) {
    infra.circuitBreaker.recordFailure(provider, modelId);
    infra.healthCache.set({
      provider,
      model: modelId,
      status: "unavailable",
      reason: "Stream interrupted before first token",
      timestamp: Date.now(),
      expiresAt: Date.now() + GATEWAY_CONFIG.healthCacheTtlByStatus.timeout,
      retryable: true,
    });
    throw streamError;
  }

  // If the stream errored after emitting tokens, do NOT silently retry —
  // surface the partial result with the error so the caller can decide.
  if (streamError && tokensEmitted > 0) {
    logger.warn("ai_stream_partial_error", {
      requestId,
      mode,
      provider,
      model: modelId,
      tokensEmitted,
      error: String(streamError),
    });
  }

  return { result, model: modelId, provider, attempts, ttftMs, streamMs: finalStreamMs };
}

// Non-streaming variant used for diagnostics: verifies normal completions work
// before relying on streaming.
export async function generateTextWithFallback(opts: StreamWithFallbackOptions): Promise<{
  text: string;
  candidate: Candidate;
  provider: ProviderName;
  attempts: ModelAttempt[];
}> {
  const { candidate, provider, attempts } = await findFirstWorkingModel(opts);
  const modelId = candidate.modelId;
  const providerTimeout =
    opts.state.meta[provider]?.timeoutMs ?? GATEWAY_CONFIG.providerTimeoutDefaultMs;
  const normalizedParams = normalizeProviderParams(provider, {
    maxOutputTokens: opts.maxOutputTokens,
    temperature: opts.temperature,
  });
  const { text } = await generateText({
    model: opts.gateway(candidate),
    system: opts.system,
    messages: opts.messages,
    maxOutputTokens: normalizedParams.maxOutputTokens,
    temperature: normalizedParams.temperature,
    maxRetries: GATEWAY_CONFIG.maxRetriesDefault,
    timeout: opts.timeoutMs ?? providerTimeout,
    abortSignal: opts.abortSignal,
  });
  return { text, candidate, provider, attempts };
}

// ---------------------------------------------------------------------------
// Standalone raw connection test (task 9). Uses the global fetch directly so
// the result is isolated from the AI-SDK chat pipeline. If this fails, the
// problem is outside the chat system (key, network, or OpenRouter itself).
// ---------------------------------------------------------------------------

export interface OpenRouterTestResult {
  ok: boolean;
  url: string;
  model: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  rawText?: string;
  json?: unknown;
  error?: { name: string; message: string; stack?: string };
  diagnostics: ReturnType<typeof getLordEnvironmentDiagnostics>;
}

export async function testOpenRouterConnection(opts: {
  apiKey: string;
  model?: string;
  prompt?: string;
}): Promise<OpenRouterTestResult> {
  const model = opts.model ?? OPENROUTER_DEFAULT_MODEL;
  const url = `${OPENROUTER_BASE_URL}${OPENROUTER_CHAT_PATH}`;
  const body = {
    model,
    stream: false,
    messages: [{ role: "user", content: opts.prompt ?? "Say hello." }],
    max_tokens: 512,
    temperature: 0,
  };
  const diagnostics = getLordEnvironmentDiagnostics();
  const logger = getGatewayInfrastructure().logger;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_CONFIG.providerTimeoutDefaultMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawText = await res.text();
    const responseHeaders: Record<string, string> = {};
    if (typeof res.headers?.entries === "function") {
      for (const [k, v] of res.headers.entries()) responseHeaders[k] = v;
    }

    let json: unknown;
    try {
      json = JSON.parse(rawText);
    } catch {
      json = undefined;
    }

    return {
      ok: res.ok,
      url,
      model,
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      rawText,
      json,
      diagnostics,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    logger.error("openrouter_test_failed", {
      model,
      error: message,
    });
    return {
      ok: false,
      url,
      model,
      error: { name, message, stack },
      diagnostics,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Clear the per-mode preferred-candidate cache. Without this a previously
// cached candidate keeps being returned without any probe, which can hide a
// provider (or a fixed API key) from routing until the TTL expires.
export function resetProbeCache(): void {
  probeCache.clear();
}

// Clear all circuit-breaker, health-cache and probe-cache state. Intended for
// tests and hot-reload safety so a previous process' failure counts and
// preferred models are not inherited.
export function resetCircuitBreakers(): void {
  const infra = getGatewayInfrastructure();
  infra.circuitBreaker.resetAll();
  infra.healthCache.clear();
  resetProbeCache();
  resetGatewayInfrastructure();
}

export {
  LORD_MODELS,
  LORD_SYSTEM_PROMPT,
  getLordModelCandidates,
  buildCandidates,
  getModeCandidates,
  classifyModelError,
  type LordMode,
  type ModelAttempt,
  type ProviderName,
  type Candidate,
  PROVIDER_CONFIG,
} from "./lord-config";
