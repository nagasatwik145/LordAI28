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

function logChat(event: string, payload: Record<string, unknown>) {
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

function buildUserFriendlyMessage(
  attempts: ModelAttempt[],
  providerStatuses: ProviderStatus[],
): string {
  if (providerStatuses.length === 0) {
    return "No AI providers are currently available. Please try again in a few moments.";
  }

  const parts: string[] = [];
  for (const ps of providerStatuses) {
    switch (ps.status) {
      case "missing_api_key":
        parts.push(`${ps.provider} is missing an API key.`);
        break;
      case "unavailable":
        parts.push(`${ps.provider} is temporarily unavailable.`);
        break;
      case "rate_limited":
        parts.push(`${ps.provider} is rate limited.`);
        break;
      case "invalid":
        parts.push(`${ps.provider} has an invalid configuration.`);
        break;
      default:
        parts.push(`${ps.provider} is experiencing issues.`);
    }
  }

  if (parts.length === 0) {
    return "All AI providers are currently unavailable. Please try again in a few moments.";
  }

  return parts.join(" ") + " Please try again in a few moments.";
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
        logChat("chat_handler_enter", { requestId, message: "CHAT HANDLER ENTER" });
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

        const logger = createLogger(GATEWAY_CONFIG);
        const lordState: LordProvidersState = createLordProviders(logger);
        const gateway: LordModelGateway = createLordGateway(lordState);
        const modelMessages = await convertToModelMessages(uiMessages);
        let tokenUsageEvent: TokenUsageEvent | null = null;
        const modelWaitStart = performance.now();

        // Run lightweight startup validation in the background so the first
        // real request benefits from it without blocking the user. Subsequent
        // requests reuse the cached result.
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

          // When credits/rate-limits fail for one model they fail for all, so
          // surface the most specific status we have.
          if (attempts?.some((a) => a.reason === "Insufficient credits")) {
            return apiErrorResponse(
              402,
              "AI_CREDITS_EXHAUSTED",
              "AI credits are exhausted. Add workspace credits and try again.",
              requestId,
              {
                attempts:
                  attempts?.map((a) => ({
                    model: a.model,
                    status: a.status,
                    reason: a.reason,
                    retryable: a.retryable,
                    providerMessage: sanitizeProviderMessage(a.providerMessage),
                    errorCode: a.errorCode,
                    requestId: a.requestId,
                  })) ?? [],
                providerStatuses,
              },
            );
          }
          if (attempts?.some((a) => a.reason === "Rate limited")) {
            return apiErrorResponse(
              429,
              "AI_RATE_LIMITED",
              "AI is receiving too many requests. Please retry shortly.",
              requestId,
              {
                attempts:
                  attempts?.map((a) => ({
                    model: a.model,
                    status: a.status,
                    reason: a.reason,
                    retryable: a.retryable,
                    providerMessage: sanitizeProviderMessage(a.providerMessage),
                    errorCode: a.errorCode,
                    requestId: a.requestId,
                  })) ?? [],
                providerStatuses,
              },
            );
          }

          const { reason, status } = classifyModelError(err);
          const authLabel = GATEWAY_CONFIG.errorReasonLabels.invalid_api_key;
          const everyAttemptWasAuthFailure =
            !!attempts && attempts.length > 0 && attempts.every((a) => a.reason === authLabel);
          if (reason === "invalid_api_key" || everyAttemptWasAuthFailure) {
            return apiErrorResponse(
              401,
              "AI_AUTH_ERROR",
              "The AI provider rejected the request. Check the server API key.",
              requestId,
              {
                attempts: attempts?.map((a) => ({
                  model: a.model,
                  status: a.status,
                  reason: a.reason,
                  retryable: a.retryable,
                  providerMessage: sanitizeProviderMessage(a.providerMessage),
                  errorCode: a.errorCode,
                  requestId: a.requestId,
                })),
                configuredProviders: routing?.configuredProviders,
                providerStatuses,
              },
            );
          }
          if (reason === "malformed_request" || reason === "invalid_messages") {
            return apiErrorResponse(
              400,
              "AI_BAD_REQUEST",
              "The AI request was malformed.",
              requestId,
              {
                attempts: attempts?.map((a) => ({
                  model: a.model,
                  status: a.status,
                  reason: a.reason,
                  retryable: a.retryable,
                  providerMessage: sanitizeProviderMessage(a.providerMessage),
                  errorCode: a.errorCode,
                  requestId: a.requestId,
                })),
                providerStatuses,
              },
            );
          }

          // "All configured models failed" is only accurate once every
          // configured provider has genuinely been attempted. When routing
          // stopped early, say so instead of blaming every provider.
          const userMessage = !routing
            ? "The AI request failed before the provider fallback could complete. Please try again in a few moments."
            : !routing.allProvidersAttempted
              ? `The AI request stopped before every configured provider was tried (not attempted: ${routing.notAttemptedProviders.join(", ")}). Please try again in a few moments.`
              : providerStatuses && providerStatuses.length > 0
                ? buildUserFriendlyMessage(attempts ?? [], providerStatuses)
                : "All configured models failed.";

          return apiErrorResponse(502, "AI_UPSTREAM_ERROR", userMessage, requestId, {
            attempts:
              attempts?.map((a) => ({
                model: a.model,
                status: a.status,
                reason: a.reason,
                retryable: a.retryable,
                providerMessage: sanitizeProviderMessage(a.providerMessage),
                errorCode: a.errorCode,
                requestId: a.requestId,
              })) ?? [],
            configuredProviders: routing?.attemptedProviders,
            providerStatuses,
          });
        }
      },
    },
  },
});
