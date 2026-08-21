// Structured, user-safe errors for the image pipeline.
//
// Nothing in the image pipeline throws a raw `Error` or leaks a provider stack
// trace / response body to the client. Every failure is an
// {@link ImageGenerationError} carrying:
//
//   code        stable machine code the UI can branch on
//   message     clean, user-facing sentence (no secrets, no stack traces)
//   status      HTTP status the API route should answer with
//   recoverable whether retrying could plausibly succeed
//   hint        optional actionable next step (operator or user)
//
// `toImageErrorBody()` produces the exact wire contract the frontend consumes:
//   { success: false, error: string, recoverable: boolean, code, … }

/** Stable machine codes for every failure the image pipeline can produce. */
export type ImageErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "INVALID_MODEL"
  | "MODEL_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "CONTENT_BLOCKED"
  | "TIMEOUT"
  | "MALFORMED_RESPONSE"
  | "PROVIDER_ERROR"
  | "ALL_MODELS_FAILED";

/** Default HTTP status per code, so routes never invent their own. */
const STATUS_BY_CODE: Record<ImageErrorCode, number> = {
  MISSING_CREDENTIALS: 503,
  INVALID_CREDENTIALS: 401,
  RATE_LIMITED: 429,
  INVALID_MODEL: 400,
  MODEL_UNAVAILABLE: 503,
  INVALID_REQUEST: 400,
  CONTENT_BLOCKED: 422,
  TIMEOUT: 504,
  MALFORMED_RESPONSE: 502,
  PROVIDER_ERROR: 502,
  ALL_MODELS_FAILED: 503,
};

/**
 * Whether a code is worth retrying. Credential/model/prompt problems need a
 * human change first, so they are reported as non-recoverable; capacity and
 * transport problems are recoverable.
 */
const RECOVERABLE_BY_CODE: Record<ImageErrorCode, boolean> = {
  MISSING_CREDENTIALS: false,
  INVALID_CREDENTIALS: false,
  RATE_LIMITED: true,
  INVALID_MODEL: false,
  MODEL_UNAVAILABLE: true,
  INVALID_REQUEST: false,
  CONTENT_BLOCKED: false,
  TIMEOUT: true,
  MALFORMED_RESPONSE: true,
  PROVIDER_ERROR: true,
  ALL_MODELS_FAILED: true,
};

export interface ImageErrorOptions {
  status?: number;
  recoverable?: boolean;
  hint?: string;
  /** Registry model id involved in the failure, when known. */
  model?: string;
  /** Provider-supplied message, already sanitized (no secrets, no HTML). */
  providerMessage?: string;
  /** Cloudflare request id, for support correlation. */
  providerRequestId?: string;
  /** How long the failing call took, in ms. */
  durationMs?: number;
}

/** The only error type the image pipeline throws. */
export class ImageGenerationError extends Error {
  readonly code: ImageErrorCode;
  readonly status: number;
  readonly recoverable: boolean;
  readonly hint?: string;
  readonly model?: string;
  readonly providerMessage?: string;
  readonly providerRequestId?: string;
  readonly durationMs?: number;

  constructor(code: ImageErrorCode, message: string, options: ImageErrorOptions = {}) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.recoverable = options.recoverable ?? RECOVERABLE_BY_CODE[code];
    this.hint = options.hint;
    this.model = options.model;
    this.providerMessage = options.providerMessage;
    this.providerRequestId = options.providerRequestId;
    this.durationMs = options.durationMs;
  }

  /** Structured, log-safe summary (never includes secrets or stack traces). */
  toLogFields(): Record<string, unknown> {
    return {
      code: this.code,
      status: this.status,
      recoverable: this.recoverable,
      model: this.model,
      durationMs: this.durationMs,
      providerMessage: this.providerMessage,
      providerRequestId: this.providerRequestId,
    };
  }
}

/** The wire contract for a failed image request (spec §8). */
export interface ImageErrorBody {
  success: false;
  /** Provider that handled the final attempt; failures are provider-neutral. */
  provider: "cloudflare" | "openrouter";
  /** HTTP status the API responded with (or that the route should use). */
  status: number;
  /** Stable machine code the UI can branch on. */
  code: ImageErrorCode;
  /** User-facing sentence (no secrets, no stack traces). */
  error: string;
  /** True when retrying could plausibly succeed. */
  recoverable: boolean;
  hint?: string;
  model?: string;
  requestId?: string;
  /** Extra, log-safe structured context (never secrets). */
  details?: Record<string, unknown>;
}

/**
 * Convert any thrown value into the client-facing error body. Unknown throwables
 * collapse to a generic provider error so an internal message or stack trace can
 * never reach the client.
 */
export function toImageErrorBody(error: unknown, requestId?: string): ImageErrorBody {
  const safe = toImageError(error);
  const details: Record<string, unknown> = {};
  if (safe.providerRequestId) details.providerRequestId = safe.providerRequestId;
  if (safe.durationMs != null) details.durationMs = safe.durationMs;
  return {
    success: false,
    provider: "cloudflare",
    status: safe.status,
    code: safe.code,
    error: safe.message,
    recoverable: safe.recoverable,
    ...(safe.hint ? { hint: safe.hint } : {}),
    ...(safe.model ? { model: safe.model } : {}),
    ...(requestId ? { requestId } : {}),
    ...(Object.keys(details).length ? { details } : {}),
  };
}

/** Narrow any thrown value to an {@link ImageGenerationError}. */
export function toImageError(error: unknown): ImageGenerationError {
  if (error instanceof ImageGenerationError) return error;
  if (isTimeoutLike(error)) {
    return new ImageGenerationError("TIMEOUT", "Cloudflare request timed out.", {
      hint: "Try again shortly or pick a faster model.",
    });
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new ImageGenerationError("PROVIDER_ERROR", "Could not reach Cloudflare Workers AI.", {
      hint: "Check the server's network connectivity to api.cloudflare.com.",
    });
  }
  return new ImageGenerationError("PROVIDER_ERROR", "Image generation failed. Please try again.");
}

/** True for an aborted/timed-out fetch in Node, Workers, and the browser. */
export function isTimeoutLike(error: unknown): boolean {
  if (error instanceof DOMException)
    return error.name === "TimeoutError" || error.name === "AbortError";
  if (error instanceof Error) return error.name === "TimeoutError" || error.name === "AbortError";
  return false;
}

/** The error thrown when every configured Cloudflare model failed (spec §8). */
export function allModelsUnavailableError(options: ImageErrorOptions = {}): ImageGenerationError {
  return new ImageGenerationError(
    "ALL_MODELS_FAILED",
    "All Cloudflare image models are unavailable.",
    { hint: "Check Cloudflare Workers AI status and credentials, then retry.", ...options },
  );
}

// ---------------------------------------------------------------------------
// Cloudflare response classification
// ---------------------------------------------------------------------------

/** Cloudflare rejects a JSON body for models that require multipart/form-data. */
export function isMultipartRequiredError(message: string): boolean {
  return /required properties.*'?multipart'?/i.test(message) || /are 'multipart'/i.test(message);
}

/** Cloudflare rejects bodies that carry properties a model does not declare. */
export function isUnknownPropertyError(message: string): boolean {
  return /additional or unevaluated properties/i.test(message);
}

/** True when the provider message indicates a content-policy rejection. */
export function isContentBlockedError(message: string): boolean {
  return /content.?polic|moderation|inappropriate|nsfw|safety|blocked/i.test(message);
}

/**
 * Map a non-2xx Cloudflare response to a structured error.
 *
 * @param status HTTP status returned by Cloudflare.
 * @param providerMessage first `errors[].message` from the body, when parsable.
 * @param context model id / request id / duration for diagnostics.
 */
export function classifyCloudflareFailure(
  status: number,
  providerMessage: string | undefined,
  context: { model?: string; providerRequestId?: string; durationMs?: number } = {},
): ImageGenerationError {
  const detail = providerMessage?.trim() || undefined;
  const base: ImageErrorOptions = { ...context, providerMessage: detail };

  if (status === 401 || status === 403) {
    return new ImageGenerationError("INVALID_CREDENTIALS", "Cloudflare rejected the API token.", {
      ...base,
      hint: "Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID on the server.",
    });
  }
  if (status === 429) {
    return new ImageGenerationError(
      "RATE_LIMITED",
      "Cloudflare is rate limiting image generation. Please try again shortly.",
      { ...base, hint: "Wait a moment before retrying." },
    );
  }
  if (status === 404) {
    return new ImageGenerationError(
      "INVALID_MODEL",
      "The requested Cloudflare model was not found.",
      {
        ...base,
        hint: "Verify CLOUDFLARE_IMAGE_MODEL is available on this Cloudflare account.",
      },
    );
  }
  if (status === 408 || status === 504) {
    return new ImageGenerationError("TIMEOUT", "Cloudflare request timed out.", {
      ...base,
      hint: "Try again shortly or pick a faster model.",
    });
  }
  if (status === 400 || status === 422) {
    if (detail && isContentBlockedError(detail)) {
      return new ImageGenerationError(
        "CONTENT_BLOCKED",
        "This prompt cannot be used to generate an image.",
        { ...base, hint: "Rephrase the prompt and try again." },
      );
    }
    if (detail && isUnknownPropertyError(detail)) {
      return new ImageGenerationError(
        "INVALID_REQUEST",
        "Cloudflare rejected the request parameters for this model.",
        { ...base, hint: "The request included a parameter this model does not accept." },
      );
    }
    return new ImageGenerationError("INVALID_REQUEST", "Cloudflare rejected the image request.", {
      ...base,
      hint: "Adjust the prompt or image settings and try again.",
    });
  }
  if (status >= 500) {
    return new ImageGenerationError("PROVIDER_ERROR", "Cloudflare is temporarily unavailable.", {
      ...base,
      hint: "Try again shortly.",
    });
  }
  return new ImageGenerationError("PROVIDER_ERROR", "Cloudflare image generation failed.", base);
}
