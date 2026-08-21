import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, type UIMessage } from "ai";
import { z } from "zod";
import {
  streamWithFallback,
  LORD_MODELS,
  LORD_SYSTEM_PROMPT,
  classifyModelError,
  createLordProviders,
  createLordGateway,
  getConfiguredProviders,
  validateProvidersAtStartup,
  getGatewayInfrastructure,
  AllProvidersFailedError,
  getProviderConfigurationDiagnostics,
  type LordModelGateway,
  type LordProvidersState,
  type LordMode,
  type ModelAttempt,
  type StartupValidationResult,
  logStartupBanner,
} from "@/lib/ai-gateway.server";
import type { TokenUsageEvent } from "@/lib/token-usage-store";
import { apiErrorResponse, getSafeErrorMessage, type ProviderStatus } from "@/lib/api-error";
import {
  createLordError,
  lordErrorResponse,
  type LordError,
  type LordErrorCode,
} from "@/lib/lord-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { retrieveMemories, type MemoryRecord } from "@/lib/memory";
import { GATEWAY_CONFIG } from "@/lib/gateway-config";
import { createLogger } from "@/lib/gateway-logger";

const MODE_ENUM = Object.keys(LORD_MODELS) as [LordMode, ...LordMode[]];

const ChatRequestSchema = z.object({
  messages: z
    .array(
      z
        .object({
          role: z.enum(["user", "assistant", "system"]),
          parts: z.array(z.unknown()).max(100),
        })
        .passthrough(),
    )
    .min(1)
    .max(100),
  mode: z.enum(MODE_ENUM).optional(),
  modelId: z.string().min(1).optional(),
  context: z
    .object({
      page: z.string().max(200).optional(),
      workflow: z.string().max(200).nullable().optional(),
      projectId: z.string().uuid().optional().nullable(),
    })
    .passthrough()
    .optional(),
});

function sanitizeProviderMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const trimmed = message.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "Provider returned an error. Reference ID: " + crypto.randomUUID().slice(0, 8);
  }
  if (trimmed.length > 200) {
    return trimmed.slice(0, 200) + "...";
  }
  return trimmed;
}

// Verbose per-request tracing. Suppressed in production unless LORD_CHAT_DEBUG
// is set, so we never leak request previews / diagnostics into prod logs.
const CHAT_DEBUG = process.env.LORD_CHAT_DEBUG === "true";

// ---------------------------------------------------------------------------
// Structured, request-correlated logging (Phase 2 / Phase 3).
// These run in ALL environments so every error carries a request id and the
// frontend can always correlate a failure to a backend log line. Secrets are
// never logged.
// ---------------------------------------------------------------------------

function logRequest(event: string, payload: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...payload }));
}

function logRequestError(event: string, payload: Record<string, unknown>) {
  console.error(JSON.stringify({ event, ...payload }));
}

interface ResolvedChatFailure {
  code: LordErrorCode;
  httpStatus: number;
  message: string;
  recoverable: boolean;
}

// Normalize any thrown value from the gateway into one of the `LordError` codes
// plus an HTTP status and a user-facing message (Phases 5, 11, 12).
function resolveChatFailure(args: {
  err: unknown;
  attempts?: ModelAttempt[];
  routing: AllProvidersFailedError | null;
}): ResolvedChatFailure {
  const { err, attempts, routing } = args;
  const authLabel = GATEWAY_CONFIG.errorReasonLabels.invalid_api_key;

  if (attempts?.some((a) => a.reason === "Insufficient credits")) {
    return {
      code: "AI_CREDITS_EXHAUSTED",
      httpStatus: 402,
      recoverable: true,
      message: "AI credits are exhausted. Add workspace credits and try again.",
    };
  }
  if (!routing && attempts?.some((a) => a.reason === "Rate limited")) {
    return {
      code: "AI_RATE_LIMITED",
      httpStatus: 429,
      recoverable: true,
      message: "AI is receiving too many requests. Please retry shortly.",
    };
  }

  const { reason } = classifyModelError(err);
  const everyAttemptWasAuthFailure =
    !!attempts && attempts.length > 0 && attempts.every((a) => a.reason === authLabel);

  if (reason === "invalid_api_key" || everyAttemptWasAuthFailure) {
    return {
      code: "AI_AUTH_ERROR",
      httpStatus: 401,
      recoverable: false,
      message: "The AI provider rejected the request. Check the server API key.",
    };
  }
  if (reason === "malformed_request" || reason === "invalid_messages") {
    return {
      code: "AI_BAD_REQUEST",
      httpStatus: 400,
      recoverable: false,
      message: "The AI request was malformed.",
    };
  }
  if (reason === "model_unavailable") {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      httpStatus: 502,
      recoverable: true,
      message: "The selected model is unavailable. Trying a fallback model.",
    };
  }

  // Routing exhausted (or aborted before routing completed).
  const userMessage = !routing
    ? "The AI request failed before the provider fallback could complete. Please try again in a few moments."
    : !routing.allProvidersAttempted
      ? `The AI request stopped before every configured provider was tried (not attempted: ${routing.notAttemptedProviders.join(", ")}). Please try again in a few moments.`
      : "All AI providers are temporarily unavailable. Please try again in a few moments.";

  return {
    code: "AI_UPSTREAM_ERROR",
    httpStatus: 502,
    recoverable: true,
    message: userMessage,
  };
}

function logChat(event: string, payload: Record<string, unknown>) {
  if (!CHAT_DEBUG) return;
  console.info(JSON.stringify({ event, ...payload }));
}

interface LatencyMeasurement {
  event: "ai_latency";
  requestId: string;
  provider?: string;
  model?: string;
  authMs: number;
  dbMs: number;
  modelWaitMs: number;
  ttftMs: number;
  streamMs: number;
  totalMs: number;
}

function logLatency(m: LatencyMeasurement) {
  if (!CHAT_DEBUG) return;
  console.info(JSON.stringify(m));
}

function getLastUserText(messages: UIMessage[]) {
  return (
    messages
      .slice()
      .reverse()
      .find((message) => message.role === "user")
      ?.parts?.filter((part) => part.type === "text")
      .map((part) => (part as { text: string }).text)
      .join("")
      .slice(0, 120) ?? ""
  );
}

import { buildBrainContext, type BrainContextOptions } from "@/lib/brain/context";

async function buildMemoryPrompt(
  supabase: SupabaseClient<Database>,
  userId: string,
  query: string,
  projectId?: string | null,
): Promise<string> {
  try {
    const opts: BrainContextOptions = {
      userId,
      projectId: projectId ?? null,
      query,
      maxMemories: 8,
      maxKnowledgeChunks: 3,
      maxRecentChats: 3,
      includePinnedNotes: true,
      includeRecentTasks: false,
      tokenBudget: 800,
    };
    const result = await buildBrainContext(opts);
    return result.systemPromptSnippet;
  } catch {
    return "";
  }
}

function buildProviderStatuses(validationResults: StartupValidationResult[]): ProviderStatus[] {
  const statuses: ProviderStatus[] = [];
  for (const result of validationResults) {
    if (result.unhealthy.length === 0) {
      statuses.push({ provider: result.provider, status: "healthy" });
    } else {
      const allInvalid = result.unhealthy.every(
        (u) => u.reason === "Provider not configured (missing API key)",
      );
      const allUnavailable = result.unhealthy.every(
        (u) => u.reason !== "Provider not configured (missing API key)",
      );
      if (allInvalid) {
        statuses.push({ provider: result.provider, status: "missing_api_key" });
      } else if (allUnavailable) {
        statuses.push({ provider: result.provider, status: "unavailable" });
      } else {
        statuses.push({ provider: result.provider, status: "unavailable" });
      }
    }
  }
  return statuses;
}

let startupValidationPromise: Promise<StartupValidationResult[]> | null = null;

async function getStartupValidation(state: LordProvidersState): Promise<StartupValidationResult[]> {
  if (!startupValidationPromise) {
    const infra = getGatewayInfrastructure();
    startupValidationPromise = validateProvidersAtStartup(state, infra).then((results) => {
      infra.logger.startupValidation(results);
      logStartupBanner(state, infra, getConfiguredProviders());
      return results;
    });
  }
  return startupValidationPromise;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        logRequest("request_start", { requestId });
        const t0 = performance.now();
        const configuredProviders = getConfiguredProviders();
        const providerDiagnostics = getProviderConfigurationDiagnostics();
        logChat("api_chat_request_start", {
          requestId,
          configuredProviders,
          // exists / first 8 characters / length only — never the secret.
          providers: providerDiagnostics.map((entry) => ({
            provider: entry.provider,
            configured: entry.configured,
            envVar: entry.envVar,
            key: entry.key,
          })),
        });

        if (configuredProviders.length === 0) {
          logChat("api_chat_config_error", {
            requestId,
            missing: ["GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY"],
          });
          return apiErrorResponse(
            503,
            "AI_NOT_CONFIGURED",
            "AI is not configured. Add at least one of GEMINI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY to the server environment.",
            requestId,
            { configuredProviders },
          );
        }

        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          logChat("api_chat_invalid_json", { requestId });
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Request body must be valid JSON.",
            requestId,
          );
        }

        const parsed = ChatRequestSchema.safeParse(rawBody);
        if (!parsed.success) {
          logChat("api_chat_invalid_request", {
            requestId,
            issues: parsed.error.issues.map((issue) => issue.message),
          });
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Please send a valid conversation with 1–100 messages.",
            requestId,
          );
        }

        const body = parsed.data;
        const mode: LordMode = body.mode ?? "balanced";
        const explicitModelId = body.modelId;
        const uiMessages = body.messages as unknown as UIMessage[];
        const authContext = context as
          { userId?: string; supabase?: SupabaseClient<Database> } | undefined;
        let memoryPrompt = "";
        const authMs = Math.round(performance.now() - t0);
        const tAfterAuth = performance.now();

        if (authContext?.userId && authContext.supabase) {
          try {
            memoryPrompt = await buildMemoryPrompt(
              authContext.supabase,
              authContext.userId,
              getLastUserText(uiMessages),
              body.context?.projectId ?? null,
            );
          } catch (err) {
            logChat("api_chat_memory_fetch_error", {
              requestId,
              error: getSafeErrorMessage(err),
            });
          }
        }
        const dbMs = Math.round(performance.now() - tAfterAuth);
        const tAfterDb = performance.now();

        const appContextPrompt = body.context
          ? `CURRENT APPLICATION CONTEXT:\n${JSON.stringify(body.context, null, 2)}`
          : "";
        const systemPrompt = [LORD_SYSTEM_PROMPT, memoryPrompt, appContextPrompt]
          .filter(Boolean)
          .join("\n\n");

        logChat("api_chat_request_validated", {
          requestId,
          mode,
          explicitModelId: explicitModelId ?? null,
          messageCount: body.messages.length,
          lastUserPreview: getLastUserText(uiMessages),
        });
        logRequest("request_validated", {
          requestId,
          mode,
          explicitModelId: explicitModelId ?? null,
          messageCount: body.messages.length,
        });

        const logger = createLogger(GATEWAY_CONFIG);
        const lordState: LordProvidersState = createLordProviders(logger);
        const gateway: LordModelGateway = createLordGateway(lordState);
        const modelMessages = await convertToModelMessages(uiMessages);
        let tokenUsageEvent: TokenUsageEvent | null = null;
        const modelWaitStart = performance.now();

        // Run lightweight startup validation in the background so the first
        // real request benefits from it without blocking the user. Subsequent
        // requests reuse the cached result. Seed the per-mode probe cache once
        // validation learns provider health, so following requests skip the
        // pre-flight probe and start streaming immediately.
        getStartupValidation(lordState).catch(() => {
          // Startup validation is best-effort; never block the chat endpoint.
        });

        try {
          const { result, model, provider } = await streamWithFallback({
            gateway,
            state: lordState,
            mode,
            explicitModelId,
            system: systemPrompt,
            messages: modelMessages,
            requestId,
            maxOutputTokens: 1024,
            timeoutMs: GATEWAY_CONFIG.providerTimeoutDefaultMs,
            abortSignal: request.signal,
            onTokenUsage: (event) => {
              tokenUsageEvent = event;
            },
          });

          const modelWaitMs = Math.round(performance.now() - modelWaitStart);
          const ttftMs = (result as unknown as { ttftMs?: number }).ttftMs ?? 0;
          const streamMs = (result as unknown as { streamMs?: number }).streamMs ?? 0;
          const totalMs = Math.round(performance.now() - t0);

          logLatency({
            event: "ai_latency",
            requestId,
            provider,
            model,
            authMs,
            dbMs,
            modelWaitMs,
            ttftMs,
            streamMs,
            totalMs,
          });

          const response = result.toUIMessageStreamResponse({
            headers: {
              "Cache-Control": "no-store",
              "X-LordAI-Request-Id": requestId,
              "X-LordAI-Model": model,
              "X-LordAI-Provider": provider,
            },
            // Surface the REAL reason to the client instead of the SDK default
            // "An error occurred." (Phase 5 / Phase 11). The message is a
            // JSON-encoded `LordError` the frontend re-parses into an actionable
            // card. Stream-level errors are always retryable-driven: client
            // cancellation / abort is reported as recoverable so Retry is safe.
            onError: (error: unknown) => {
              const classification = classifyModelError(error);
              const rawMessage =
                classification.providerMessage ??
                (error instanceof Error ? error.message : getSafeErrorMessage(error));
              const lower = rawMessage.toLowerCase();
              const name = error instanceof Error ? error.name : "";
              let code: LordErrorCode = "AI_UPSTREAM_ERROR";
              if (classification.reason === "invalid_api_key") code = "AI_AUTH_ERROR";
              else if (
                classification.reason === "malformed_request" ||
                classification.reason === "invalid_messages"
              )
                code = "AI_BAD_REQUEST";
              else if (classification.reason === "insufficient_credits")
                code = "AI_CREDITS_EXHAUSTED";
              else if (classification.reason === "rate_limit") code = "AI_RATE_LIMITED";
              else if (classification.reason === "model_unavailable")
                code = "AI_PROVIDER_UNAVAILABLE";
              else if (
                lower.includes("timeout") ||
                lower.includes("timed out") ||
                name === "TimeoutError"
              )
                code = "AI_TIMEOUT";
              else if (lower.includes("abort") || name === "AbortError")
                code = "AI_STREAM_INTERRUPTED";
              else if (lower.includes("network") || lower.includes("fetch failed"))
                code = "AI_STREAM_INTERRUPTED";
              const lordErr = createLordError({
                code,
                provider,
                model,
                message: rawMessage,
                recoverable: classification.retryable,
                requestId,
              });
              logger.error("ai_stream_error_surfaced", {
                requestId,
                provider,
                model,
                code,
                message: rawMessage,
              });
              return JSON.stringify(lordErr);
            },
            messageMetadata: ({ part }) => {
              if (part.type !== "finish") return undefined;
              if (tokenUsageEvent) return { tokenUsage: tokenUsageEvent };
              const usage = part.totalUsage;
              return {
                tokenUsage: {
                  requestId,
                  model,
                  mode,
                  finishReason: part.finishReason,
                  inputTokens: usage.inputTokens ?? 0,
                  outputTokens: usage.outputTokens ?? 0,
                  reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
                  cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
                  totalTokens: usage.totalTokens ?? 0,
                  cost: 0,
                  timestamp: Date.now(),
                } satisfies TokenUsageEvent,
              };
            },
          });
          logChat("chat_handler_exit", {
            requestId,
            message: "CHAT HANDLER EXIT",
            status: response.status,
          });
          return response;
        } catch (err) {
          const attempts = (err as unknown as { lordAttempts?: ModelAttempt[] })?.lordAttempts;
          const lastAttempt = attempts?.[attempts.length - 1];
          const routing = err instanceof AllProvidersFailedError ? err : null;
          logChat("api_chat_stream_failed", {
            requestId,
            mode,
            reason: lastAttempt?.reason ?? classifyModelError(err).reason,
            message: getSafeErrorMessage(err),
            configuredProviders: routing?.configuredProviders ?? configuredProviders,
            attemptedProviders: routing?.attemptedProviders,
            notAttemptedProviders: routing?.notAttemptedProviders,
            allProvidersAttempted: routing?.allProvidersAttempted,
            attempts: attempts?.map((a) => ({
              model: a.model,
              status: a.status,
              reason: a.reason,
              retryable: a.retryable,
              providerMessage: sanitizeProviderMessage(a.providerMessage),
              errorCode: a.errorCode,
              requestId: a.requestId,
            })),
          });

          const providerStatuses =
            routing?.providerStatuses ??
            (err as unknown as { providerStatuses?: ProviderStatus[] })?.providerStatuses;

          const failureProvider =
            routing?.attemptedProviders?.[routing.attemptedProviders.length - 1] ?? "unknown";
          const failureModel = lastAttempt?.model ?? "unknown";

          // Normalize every failure into a single `LordError` contract
          // (Phase 5). The frontend only ever receives this shape.
          const { code, httpStatus, message, recoverable } = resolveChatFailure({
            err,
            attempts,
            routing,
          });

          const lordError: LordError = createLordError({
            code,
            provider: failureProvider,
            model: failureModel,
            message,
            recoverable,
            requestId,
          });

          logRequestError("request_failed", {
            requestId,
            mode,
            code,
            httpStatus,
            provider: failureProvider,
            model: failureModel,
            recoverable,
            reason: lastAttempt?.reason ?? classifyModelError(err).reason,
            message,
            configuredProviders: routing?.configuredProviders ?? configuredProviders,
            attemptedProviders: routing?.attemptedProviders,
            notAttemptedProviders: routing?.notAttemptedProviders,
            allProvidersAttempted: routing?.allProvidersAttempted,
          });

          return lordErrorResponse(httpStatus, lordError);
        }
      },
    },
  },
});
