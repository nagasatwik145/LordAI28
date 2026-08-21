// Centralized, normalized error contract for the LORD AI backend.
//
// Every backend failure that reaches a client must be shaped as `LordError`
// so the frontend can render an actionable, request-correlated message instead
// of a generic "An error occurred." (see Phase 5 of the production audit).
//
// Two wire formats are supported so this works for both the streaming chat
// pipeline and the JSON image pipeline:
//   - struct (object)      -> returned as the JSON body of a non-2xx response
//   - stringified struct    -> embedded into the AI-SDK UI message stream via
//                              `toUIMessageStreamResponse({ onError })`, which
//                              only accepts a string. The frontend re-parses it.

export type LordErrorCode =
  | "INVALID_REQUEST"
  | "AI_NOT_CONFIGURED"
  | "AI_AUTH_ERROR"
  | "AI_BAD_REQUEST"
  | "AI_CREDITS_EXHAUSTED"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_STREAM_INTERRUPTED"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export interface LordError {
  success: false;
  code: LordErrorCode | string;
  provider: string;
  model: string;
  message: string;
  recoverable: boolean;
  requestId: string;
}

export interface LordErrorInput {
  code: LordErrorCode | string;
  provider?: string;
  model?: string;
  message: string;
  recoverable: boolean;
  requestId: string;
}

export function createLordError(input: LordErrorInput): LordError {
  return {
    success: false,
    code: input.code,
    provider: input.provider ?? "unknown",
    model: input.model ?? "unknown",
    message: input.message,
    recoverable: input.recoverable,
    requestId: input.requestId,
  };
}

/** Coerce any thrown value / JSON body / error-part string into a `LordError`. */
export function parseLordError(input: unknown): LordError | null {
  if (input == null) return null;

  let obj: unknown = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        obj = JSON.parse(trimmed);
      } catch {
        return null;
      }
    } else {
      // Plain (non-JSON) text — cannot reconstruct a structured error, so the
      // caller should fall back to showing the raw text.
      return null;
    }
  }

  if (typeof obj !== "object") return null;
  const raw = obj as Record<string, unknown>;
  // Also accept the legacy `{ error: { code, message, requestId } }` envelope
  // produced by `apiErrorResponse` for config / invalid-request failures.
  const e =
    raw.error != null && typeof raw.error === "object"
      ? (raw.error as Record<string, unknown>)
      : raw;

  if (e.success !== false && e.code == null) return null;

  const code = typeof e.code === "string" ? e.code : "INTERNAL_ERROR";
  const requestId = typeof e.requestId === "string" ? e.requestId : "";
  const message =
    typeof e.message === "string" && e.message.length > 0
      ? e.message
      : "An unexpected error occurred.";
  const provider = typeof e.provider === "string" ? e.provider : "unknown";
  const model = typeof e.model === "string" ? e.model : "unknown";
  const recoverable = typeof e.recoverable === "boolean" ? e.recoverable : true;

  return { success: false, code, provider, model, message, recoverable, requestId };
}

function providerLabel(provider: string): string {
  switch (provider) {
    case "gemini":
      return "Gemini";
    case "openrouter":
      return "OpenRouter";
    case "openai":
      return "OpenAI";
    case "cloudflare":
      return "Cloudflare";
    default:
      return provider === "unknown" || !provider ? "The AI provider" : provider;
  }
}

function shortId(requestId: string): string {
  return requestId ? requestId.slice(0, 8).toUpperCase() : "";
}

/**
 * Turn a normalized error into the friendly, user-facing sentence required by
 * Phase 11 (e.g. "Cloudflare timeout. Request ID: 7A91. Retry.").
 */
export function formatUserFacingError(err: LordError): string {
  const id = shortId(err.requestId);
  const tag = id ? ` Request ID: ${id}.` : "";

  switch (err.code) {
    case "AI_TIMEOUT":
    case "AI_STREAM_INTERRUPTED":
      return `${providerLabel(err.provider)} timed out.${tag} Please retry.`;
    case "AI_PROVIDER_UNAVAILABLE":
      return `Provider unavailable. Switching to fallback model…${tag}`;
    case "AI_RATE_LIMITED":
      return `The AI provider is rate limiting requests. Please retry shortly.${tag}`;
    case "AI_CREDITS_EXHAUSTED":
      return `AI credits are exhausted. Add workspace credits and try again.${tag}`;
    case "AI_AUTH_ERROR":
      return `The AI provider rejected the request. Check the server API key.${tag}`;
    case "AI_BAD_REQUEST":
      return `The AI request was malformed.${tag}`;
    case "AI_NOT_CONFIGURED":
      return `AI is not configured on the server.${tag}`;
    case "INVALID_REQUEST":
      return err.message || `The request was invalid.${tag}`;
    default:
      return `${err.message}${tag}`;
  }
}

/** True when the backend considers the failure safe to retry. */
export function isRecoverable(err: LordError): boolean {
  return err.recoverable;
}

/**
 * Build a `Response` whose body is exactly a `LordError` (Phase 5). `extra`
 * fields (e.g. per-attempt diagnostics) are appended to the JSON body but are
 * ignored by the client, preserving backend observability without changing the
 * contract the frontend relies on.
 */
export function lordErrorResponse(
  status: number,
  error: LordError,
  extra?: Record<string, unknown>,
): Response {
  return Response.json(
    { ...error, ...(extra && Object.keys(extra).length > 0 ? extra : {}) },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-LordAI-Request-Id": error.requestId,
        "X-LordAI-Error-Code": error.code,
      },
    },
  );
}
