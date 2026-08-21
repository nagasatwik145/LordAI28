// Cloudflare Workers AI image generation provider.
//
// This is a *server-side* image provider: it talks directly to the Cloudflare
// Workers AI REST API using an account-scoped API token. Unlike Puter (which
// runs in the browser), every request here leaves the server and must never be
// imported into client bundles. The `.server`-style dependency boundary is kept
// by only importing this module from server routes / server-only factories.
//
// The provider reuses the shared `ImageProvider` contract from ./types so the
// rest of LORD — the gateway, gallery, analytics, and UI — receives exactly the
// same `UnifiedImageResult` shape as every other image provider. No Cloudflare-
// specific object is allowed to reach the UI.
//
// Cloudflare Workers AI response handling:
//   - Some image models return a JSON envelope `{ success, result: { image }, errors }`
//     where `result.image` is a base64-encoded PNG.
//   - Other models (and raw `image/*` responses) stream the binary image bytes
//     directly. We detect both cases from the `Content-Type` header and normalize
//     them into a `data:` URL so the result is indistinguishable from Puter's.

import type {
  GenerateImageParams,
  ImageProvider,
  ImageProviderCapabilities,
  ProviderHealth,
  UnifiedImageResult,
} from "./types";

/** Base URL for the Cloudflare Workers AI `run` endpoint (v4). */
const CLOUDFLARE_AI_BASE = "https://api.cloudflare.com/client/v4/accounts";

/** Default model used when `CLOUDFLARE_IMAGE_MODEL` is not configured. */
export const CLOUDFLARE_DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

/** Per-request timeout (ms). Image generation can be slow; keep this generous. */
const CLOUDFLARE_REQUEST_TIMEOUT_MS = 120_000;

/**
 * Capabilities advertised for Cloudflare in the provider registry. Flux-class
 * models generate but do not edit, accept an aspect ratio, and support a quality
 * hint; they do not expose a native negative-prompt or seed parameter through
 * this simple `prompt`-only contract.
 */
export const CLOUDFLARE_CAPABILITIES: ImageProviderCapabilities = {
  supportsGeneration: true,
  supportsEditing: false,
  supportsAspectRatio: true,
  supportsSeed: false,
  supportsQuality: true,
  supportsNegativePrompt: false,
  maxImages: 4,
};

/** Error codes surfaced by the Cloudflare provider (kept user-safe, no secrets). */
export type CloudflareImageErrorCode =
  | "MISSING_CREDENTIALS"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "CONTENT_BLOCKED"
  | "GENERATION_FAILED"
  | "PROVIDER_ERROR"
  | "TIMEOUT";

/**
 * Structured, user-safe error. Never includes the raw API token, request body,
 * or unredacted provider JSON — only a clean message plus an actionable hint.
 */
export class CloudflareImageProviderError extends Error {
  constructor(
    public readonly code: CloudflareImageErrorCode,
    message: string,
    public readonly status = 502,
    public readonly retryable = true,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = "CloudflareImageProviderError";
  }
}

// ---------------------------------------------------------------------------
// Configuration (read at request time — never bundle secrets into the client)
// ---------------------------------------------------------------------------

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
}

/**
 * Resolve Cloudflare configuration from the environment. The model is
 * configurable via `CLOUDFLARE_IMAGE_MODEL` and falls back to
 * {@link CLOUDFLARE_DEFAULT_IMAGE_MODEL}; the account id and token are required.
 *
 * Values are normalized (trimmed, unquoted) exactly like the rest of the
 * provider stack so a quoted/whitespace-padded secret does not produce a
 * confusing 401 from Cloudflare.
 */
export function getCloudflareConfig(): CloudflareConfig {
  const accountId = normalize(process.env.CLOUDFLARE_ACCOUNT_ID);
  const apiToken = normalize(process.env.CLOUDFLARE_API_TOKEN);
  const model = normalize(process.env.CLOUDFLARE_IMAGE_MODEL) || CLOUDFLARE_DEFAULT_IMAGE_MODEL;
  return { accountId: accountId ?? "", apiToken: apiToken ?? "", model };
}

function normalize(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let value = raw.trim();
  while (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return value.replace(/[\r\n\t]/g, "");
}

// ---------------------------------------------------------------------------
// Response parsing (binary image vs JSON envelope)
// ---------------------------------------------------------------------------

type CloudflareJsonResult =
  | {
      image?: string;
      images?: Array<string | { b64_json?: string }>;
      data?: Array<{ b64_json?: string }>;
    }
  | undefined;

type CloudflareJsonResponse = {
  success?: boolean;
  errors?: Array<{ code?: number | string; message?: string }>;
  messages?: unknown[];
  result?: CloudflareJsonResult;
};

/** Strip an optional `data:image/...;base64,` prefix from a base64 string. */
function stripDataUrlPrefix(value: string): string {
  const match = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i.exec(value);
  return match ? match[1] : value;
}

/**
 * Extract a base64 image string from the various JSON shapes Cloudflare may
 * return (a single `result.image`, `result.images[]`, or `result.data[]`).
 */
function extractBase64FromJson(json: CloudflareJsonResponse): string | undefined {
  const result = json.result;
  if (!result) return undefined;
  if (typeof result.image === "string" && result.image.length > 0) {
    return stripDataUrlPrefix(result.image);
  }
  if (Array.isArray(result.images) && result.images.length > 0) {
    const first = result.images[0];
    if (typeof first === "string") return stripDataUrlPrefix(first);
    if (first && typeof first.b64_json === "string") return first.b64_json;
  }
  if (Array.isArray(result.data) && result.data.length > 0) {
    const first = result.data[0];
    if (first && typeof first.b64_json === "string") return first.b64_json;
  }
  return undefined;
}

/** Encode an ArrayBuffer as base64 in a cross-runtime (Node + Workers) way. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Normalize a Cloudflare HTTP response into a single `data:` URL, regardless of
 * whether the body is a JSON envelope or raw binary image bytes.
 *
 * @throws {CloudflareImageProviderError} when the response is JSON, reports
 *   `success: false`, and contains no decodable image.
 */
async function responseToDataUrl(response: Response): Promise<string> {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("json")) {
    const json = (await response.json().catch(() => ({}))) as CloudflareJsonResponse;
    if (json.success === false) {
      const first = json.errors?.[0];
      throw new CloudflareImageProviderError(
        "GENERATION_FAILED",
        first?.message ?? "Cloudflare returned an unsuccessful response.",
        response.status,
        response.status >= 500,
        "Try a different prompt or model.",
      );
    }
    const base64 = extractBase64FromJson(json);
    if (!base64) {
      throw new CloudflareImageProviderError(
        "GENERATION_FAILED",
        "Cloudflare returned JSON without image data.",
        response.status,
        response.status >= 500,
      );
    }
    return `data:image/png;base64,${base64}`;
  }

  // Otherwise treat the body as raw binary image bytes.
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    throw new CloudflareImageProviderError(
      "GENERATION_FAILED",
      "Cloudflare returned an empty image body.",
      response.status,
      response.status >= 500,
    );
  }
  const mediaType = contentType.startsWith("image/") ? contentType.slice("image/".length) : "png";
  return `data:image/${mediaType};base64,${arrayBufferToBase64(buffer)}`;
}

// ---------------------------------------------------------------------------
// Logging (structured, server-side, no sensitive payloads)
// ---------------------------------------------------------------------------

type LogLevel = "info" | "warn" | "error";

function clog(level: LogLevel, event: string, payload: Record<string, unknown>): void {
  const entry = { level, event, ...payload, timestamp: Date.now() };
  if (level === "error") console.error("[cloudflare-image]", JSON.stringify(entry));
  else if (level === "warn") console.warn("[cloudflare-image]", JSON.stringify(entry));
  else console.info("[cloudflare-image]", JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Cloudflare Workers AI image provider.
 *
 * Implements the shared {@link ImageProvider} contract so the client gateway and
 * UI treat it identically to every other provider. Authentication is server-side
 * (account token), so `signIn`/`signOut` are no-ops and `isAuthenticated` simply
 * reports whether credentials are configured.
 */
export class CloudflareImageProvider implements ImageProvider {
  readonly id = "cloudflare" as const;

  async initialize(): Promise<void> {
    // No client SDK to warm up; credentials are validated lazily per request.
  }

  async signIn(): Promise<void> {
    // Server-side token auth — no user sign-in flow.
  }

  async signOut(): Promise<void> {
    // Server-side token auth — no user sign-out flow.
  }

  async isAuthenticated(): Promise<boolean> {
    const { accountId, apiToken } = getCloudflareConfig();
    return Boolean(accountId && apiToken);
  }

  /**
   * Generate one or more images from a prompt via Cloudflare Workers AI.
   *
   * @returns a {@link UnifiedImageResult} whose `images` are `data:` URLs,
   *   matching the format produced by the other image providers.
   * @throws {CloudflareImageProviderError} on missing credentials or any
   *   non-2xx Cloudflare response (with a meaningful, user-safe message).
   */
  async generateImage(params: GenerateImageParams): Promise<UnifiedImageResult> {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const config = getCloudflareConfig();

    if (!config.accountId || !config.apiToken) {
      throw new CloudflareImageProviderError(
        "MISSING_CREDENTIALS",
        "Cloudflare image generation is not configured on the server.",
        503,
        false,
        "Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (and optionally CLOUDFLARE_IMAGE_MODEL).",
      );
    }

    const model = params.model || config.model;
    const prompt = params.enhancedPrompt ?? params.prompt;
    const url = `${CLOUDFLARE_AI_BASE}/${encodeURIComponent(config.accountId)}/ai/run/${encodeURIComponent(model)}`;
    const count = Math.min(Math.max(params.count ?? 1, 1), CLOUDFLARE_CAPABILITIES.maxImages);

    clog("info", "cloudflare_request_started", {
      requestId,
      model,
      promptLength: prompt.length,
      count,
    });

    const images: string[] = [];
    let lastError: CloudflareImageProviderError | null = null;

    for (let i = 0; i < count; i++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(CLOUDFLARE_REQUEST_TIMEOUT_MS),
          body: JSON.stringify({ prompt }),
        });

        if (!response.ok) {
          throw await toProviderError(response);
        }

        const dataUrl = await responseToDataUrl(response);
        images.push(dataUrl);
        clog("info", "cloudflare_image_received", {
          requestId,
          model,
          index: i,
          bytes: dataUrl.length,
          latencyMs: Math.round(performance.now() - started),
        });
      } catch (error) {
        const wrapped =
          error instanceof CloudflareImageProviderError
            ? error
            : error instanceof DOMException && error.name === "TimeoutError"
              ? new CloudflareImageProviderError(
                  "TIMEOUT",
                  "Cloudflare image generation timed out.",
                  408,
                  true,
                  "Try again shortly.",
                )
              : new CloudflareImageProviderError(
                  "PROVIDER_ERROR",
                  "Cloudflare image generation failed.",
                  502,
                  true,
                );
        lastError = wrapped;
        clog("error", "cloudflare_image_failed", {
          requestId,
          model,
          index: i,
          code: wrapped.code,
          status: wrapped.status,
        });
        // One failed image fails the whole request (matches the OpenRouter path).
        break;
      }
    }

    if (images.length === 0) {
      throw (
        lastError ??
        new CloudflareImageProviderError("GENERATION_FAILED", "No image was generated.")
      );
    }

    return {
      provider: "Cloudflare",
      model,
      images,
      generationTime: Math.round(performance.now() - started),
      cost: 0,
      requestId,
      diagnostics: {
        provider: "Cloudflare",
        model,
        modelLabel: model,
        fallbackUsed: false,
        retryCount: 0,
        generationTimeMs: Math.round(performance.now() - started),
      },
    };
  }

  /** Report whether Cloudflare credentials are present (no billable call). */
  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    const configured = await this.isAuthenticated();
    return {
      status: configured ? "available" : "auth_required",
      authenticated: configured,
      available: configured,
      rateLimited: false,
      reason: configured ? undefined : "Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN",
      checkedAt,
    };
  }
}

/** Map a non-2xx Cloudflare response to a structured, user-safe error. */
async function toProviderError(response: Response): Promise<CloudflareImageProviderError> {
  const status = response.status;
  let message = "Cloudflare image generation failed.";
  try {
    const json = (await response.json().catch(() => ({}))) as CloudflareJsonResponse;
    const first = json.errors?.[0];
    if (first?.message) message = first.message;
  } catch {
    // Body was not JSON; keep the generic message.
  }

  if (status === 401 || status === 403) {
    return new CloudflareImageProviderError(
      "AUTH_FAILED",
      "Cloudflare rejected the API token.",
      401,
      false,
      "Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID on the server.",
    );
  }
  if (status === 429) {
    return new CloudflareImageProviderError(
      "RATE_LIMITED",
      "Cloudflare is rate limiting image generation. Please try again shortly.",
      429,
      true,
      "Wait a moment before retrying.",
    );
  }
  if (status === 400 || status === 422) {
    return new CloudflareImageProviderError(
      "INVALID_REQUEST",
      message,
      status,
      false,
      "Check the prompt and model name (CLOUDFLARE_IMAGE_MODEL).",
    );
  }
  if (status >= 500) {
    return new CloudflareImageProviderError(
      "PROVIDER_ERROR",
      "Cloudflare is temporarily unavailable.",
      502,
      true,
      "Try again shortly.",
    );
  }
  return new CloudflareImageProviderError("GENERATION_FAILED", message, status, status >= 500);
}

/** Singleton used by the server gateway and the provider factory. */
export const cloudflareProvider = new CloudflareImageProvider();
