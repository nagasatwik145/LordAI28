// The only image provider LORD ships: Cloudflare Workers AI.
//
// This module owns nothing but Cloudflare transport concerns. It speaks the
// {@link ImageProvider} contract from `image-types.ts`, so the router never
// imports Cloudflare-specific shapes and a future provider cannot leak its own
// types into the UI. Every request body is built strictly from the registry
// contract (`image-models.ts`) — parameters a model does not declare are dropped,
// and every numeric value is clamped into the bounds the schema publishes.
//
// Server-only. Uses the global `fetch`/`FormData` (Node 18+ / Workers).

import {
  getImageModel,
  getImageModelLabel,
  getImageModelParams,
  resolveConfiguredModelId,
} from "./image-models";
import {
  getCapabilitiesForEntry,
  resolveGuidance,
  resolveModelDimensions,
  resolveSeed,
  resolveSteps,
} from "./image-capabilities";
import { classifyCloudflareFailure, ImageGenerationError, isTimeoutLike } from "./image-errors";
import { createStructuredLogger, type StructuredLogger } from "../shared/structured-logger";
import type {
  ImageProvider,
  ImageProviderAuth,
  ImageProviderHealth,
  ImageModelHealth,
  ImageModelCapabilities,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from "./image-types";
import { IMAGE_PROVIDER_ID, IMAGE_PROVIDER_LABEL } from "./image-types";
import { IMAGE_MODEL_REGISTRY, type ImageModelRegistryEntry } from "./image-models";
import { readEnvApiKey } from "../../env.server";

const ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const MODEL_ENV = "CLOUDFLARE_IMAGE_MODEL";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const HEALTH_CACHE_TTL_MS = 60_000;
const HEALTH_LIST_TIMEOUT_MS = 15_000;

const CLOUDFLARE_BASE = "https://api.cloudflare.com/client/v4";

/** Field names whose values must never appear in logs. */
const SECRET_HEADER_KEYS = new Set(["authorization", "x-auth-token", "cookie", "set-cookie"]);

/** Redact secret header values before logging. */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADER_KEYS.has(key.toLowerCase()) ? "<redacted>" : value;
  }
  return out;
}

export interface CloudflareProviderOptions {
  /** Override `fetch` (tests, edge runtimes). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Request timeout per attempt, in ms. */
  timeoutMs?: number;
  /** Retries for recoverable failures (429 / 5xx / timeout). */
  maxRetries?: number;
  logger?: StructuredLogger;
}

function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function mimeFromDeclared(declared?: string): string {
  if (!declared) return "image/png";
  const mime = declared.split(";")[0].trim();
  if (mime.startsWith("image/")) return mime;
  return "image/png";
}

export class CloudflareImageProvider implements ImageProvider {
  readonly id = IMAGE_PROVIDER_ID;
  readonly label = IMAGE_PROVIDER_LABEL;

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly log: StructuredLogger;
  private healthCache: { at: number; models: string[] | null } | null = null;

  constructor(options: CloudflareProviderOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ?? ((globalThis.fetch ?? (undefined as never)) as typeof fetch);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.log = (options.logger ?? createStructuredLogger("image:cloudflare")).child({
      provider: this.id,
    });
  }

  // -------------------------------------------------------------------------
  // Credentials (no I/O)
  // -------------------------------------------------------------------------

  authenticate(): ImageProviderAuth {
    const accountId = readEnvApiKey(ACCOUNT_ENV);
    const token = readEnvApiKey(TOKEN_ENV);
    const missingEnv: string[] = [];
    if (!accountId) missingEnv.push(ACCOUNT_ENV);
    if (!token) missingEnv.push(TOKEN_ENV);
    const configuredModel = resolveConfiguredModelId(process.env[MODEL_ENV]).id;
    return {
      configured: missingEnv.length === 0,
      missingEnv,
      accountIdPresent: Boolean(accountId),
      tokenPresent: Boolean(token),
      configuredModel,
    };
  }

  // -------------------------------------------------------------------------
  // Capabilities
  // -------------------------------------------------------------------------

  capabilities(model?: string): ImageModelCapabilities {
    const entry = getImageModel(model) ?? IMAGE_MODEL_REGISTRY[0];
    return getCapabilitiesForEntry(entry);
  }

  // -------------------------------------------------------------------------
  // Available models (cached, non-billable list call)
  // -------------------------------------------------------------------------

  async listAvailableModels(): Promise<string[] | null> {
    if (this.healthCache && Date.now() - this.healthCache.at < HEALTH_CACHE_TTL_MS) {
      return this.healthCache.models;
    }
    const auth = this.authenticate();
    if (!auth.configured) {
      this.healthCache = { at: Date.now(), models: null };
      return null;
    }
    const url = `${CLOUDFLARE_BASE}/accounts/${readEnvApiKey(ACCOUNT_ENV)}/ai/models?task=text-to-image`;
    try {
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${readEnvApiKey(TOKEN_ENV)}` },
        signal: AbortSignal.timeout(HEALTH_LIST_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.log.warn("list_models_failed", { status: res.status });
        this.healthCache = { at: Date.now(), models: null };
        return null;
      }
      const json = (await res.json()) as { result?: Array<{ id?: string }> };
      const ids = (json.result ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string");
      this.healthCache = { at: Date.now(), models: ids };
      return ids;
    } catch (error) {
      this.log.warn("list_models_error", { error: (error as Error).message });
      this.healthCache = { at: Date.now(), models: null };
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Health (credentials + connectivity + per-model availability)
  // -------------------------------------------------------------------------

  async healthCheck(models?: readonly string[]): Promise<ImageProviderHealth> {
    const checkedAt = Date.now();
    const auth = this.authenticate();
    const configuredModel = auth.configuredModel;

    if (!auth.configured) {
      return {
        provider: this.id,
        providerLabel: this.label,
        status: "missing_credentials",
        healthy: false,
        credentialsConfigured: false,
        missingEnv: auth.missingEnv,
        configuredModel,
        reason: `Missing ${auth.missingEnv.join(", ")}.`,
        checkedAt,
        models: IMAGE_MODEL_REGISTRY.map((entry) => ({
          model: entry.id,
          label: entry.label,
          status: "missing_credentials" as const,
          healthy: false,
          reason: "Credentials not configured.",
          checkedAt,
        })),
      };
    }

    const available = await this.listAvailableModels();
    const latencyMs = Date.now() - checkedAt;

    if (available === null) {
      return {
        provider: this.id,
        providerLabel: this.label,
        status: "offline",
        healthy: false,
        credentialsConfigured: true,
        missingEnv: [],
        configuredModel,
        latencyMs,
        reason: "Could not reach Cloudflare to list models.",
        checkedAt,
        models: IMAGE_MODEL_REGISTRY.map((entry) => ({
          model: entry.id,
          label: entry.label,
          status: "offline" as const,
          healthy: false,
          reason: "Connectivity check failed.",
          checkedAt,
        })),
      };
    }

    const wanted = models?.length ? models : IMAGE_MODEL_REGISTRY.map((e) => e.id);
    const modelHealth: ImageModelHealth[] = IMAGE_MODEL_REGISTRY.filter((e) =>
      wanted.includes(e.id),
    ).map((entry) => {
      const healthy = available.includes(entry.id);
      return {
        model: entry.id,
        label: entry.label,
        status: healthy ? ("healthy" as const) : ("model_unavailable" as const),
        healthy,
        ...(healthy ? {} : { reason: "Model not available on this Cloudflare account." }),
        checkedAt,
      };
    });

    const anyHealthy = modelHealth.some((m) => m.healthy);
    return {
      provider: this.id,
      providerLabel: this.label,
      status: anyHealthy ? "healthy" : "model_unavailable",
      healthy: anyHealthy,
      credentialsConfigured: true,
      missingEnv: [],
      configuredModel,
      latencyMs,
      ...(anyHealthy ? {} : { reason: "No configured Cloudflare image model is available." }),
      checkedAt,
      models: modelHealth,
    };
  }

  // -------------------------------------------------------------------------
  // Generation
  // -------------------------------------------------------------------------

  async generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult> {
    const entry = getImageModel(request.model);
    if (!entry) {
      throw new ImageGenerationError("INVALID_MODEL", "Unknown image model.", {
        model: request.model,
      });
    }
    const auth = this.authenticate();
    if (!auth.configured) {
      throw new ImageGenerationError("MISSING_CREDENTIALS", "Cloudflare configuration missing.", {
        model: entry.id,
        hint: `Set ${auth.missingEnv.join(", ")} on the server.`,
      });
    }

    const accountId = readEnvApiKey(ACCOUNT_ENV)!;
    const token = readEnvApiKey(TOKEN_ENV)!;
    const url = `${CLOUDFLARE_BASE}/accounts/${accountId}/ai/run/${encodeURIComponent(entry.id)}`;

    const { body, inputMode } = this.buildRequest(entry, request);
    const start = Date.now();
    let attempt = 0;
    let lastError: ImageGenerationError | null = null;

    for (;;) {
      try {
        const res = await this.postCloudflare(url, token, entry, inputMode, body);
        const images = await this.parseImages(res, entry);
        const dims = resolveModelDimensions(entry, {
          width: request.width,
          height: request.height,
          aspectRatio: request.aspectRatio,
        });
        const generationTimeMs = Date.now() - start;
        this.log.info("generated", {
          model: entry.id,
          requestId: request.requestId,
          images: images.length,
          retries: attempt,
          generationTimeMs,
        });
        return {
          provider: this.id,
          model: entry.id,
          images,
          width: dims.width,
          height: dims.height,
          seed: request.seed,
          retryCount: attempt,
          generationTimeMs,
          contractSource: "registry",
          inputMode,
        };
      } catch (error) {
        const classified = this.classify(error, entry, request.requestId, Date.now() - start);
        lastError = classified;
        attempt += 1;
        const willRetry = attempt <= this.maxRetries && classified.recoverable;
        this.log.warn("generate_attempt_failed", {
          model: entry.id,
          requestId: request.requestId,
          attempt,
          code: classified.code,
          recoverable: classified.recoverable,
        });
        if (!willRetry) break;
        const backoff = this.backoffMs(classified, attempt);
        await this.sleep(backoff);
      }
    }

    throw (
      lastError ??
      new ImageGenerationError("PROVIDER_ERROR", "Image generation failed.", {
        model: entry.id,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Request building
  // -------------------------------------------------------------------------

  private buildRequest(
    entry: ImageModelRegistryEntry,
    request: ProviderGenerateRequest,
  ): { body: Record<string, unknown> | FormData; inputMode: "json" | "multipart" } {
    const params = getImageModelParams(entry.id);
    const dims = resolveModelDimensions(entry, {
      width: request.width,
      height: request.height,
      aspectRatio: request.aspectRatio,
    });
    const steps = resolveSteps(entry, request.quality);
    const guidance = resolveGuidance(entry, request.quality);
    const seed = resolveSeed(entry, request.seed);

    const fields: Record<string, unknown> = { prompt: request.prompt };
    if (params.has("negative_prompt") && request.negativePrompt) {
      fields.negative_prompt = request.negativePrompt;
    }
    if (params.has("width")) fields.width = dims.width;
    if (params.has("height")) fields.height = dims.height;
    if (params.has("aspect_ratio") && !params.has("width")) fields.aspect_ratio = dims.aspectRatio;
    if (steps && params.has(steps.param)) fields[steps.param] = steps.value;
    if (guidance !== null && params.has("guidance")) fields.guidance = guidance;
    if (seed !== null && params.has("seed")) fields.seed = seed;

    if (entry.inputMode === "multipart") {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, String(value));
      }
      return { body: form, inputMode: "multipart" };
    }
    return { body: fields, inputMode: "json" };
  }

  private async postCloudflare(
    url: string,
    token: string,
    entry: ImageModelRegistryEntry,
    inputMode: "json" | "multipart",
    body: Record<string, unknown> | FormData,
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (inputMode === "json") headers["Content-Type"] = "application/json";

    const requestStart = Date.now();
    this.log.info("request", {
      stage: "sending_request",
      provider: this.id,
      model: entry.id,
      inputMode,
      endpoint: url,
      accountId: readEnvApiKey(ACCOUNT_ENV),
      headers: redactHeaders(headers),
      payload: this.sanitizePayload(body),
      timeoutMs: this.timeoutMs,
    });

    const signal = AbortSignal.timeout(this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body:
          inputMode === "json"
            ? JSON.stringify(body as Record<string, unknown>)
            : (body as FormData),
        signal,
      });
    } catch (error) {
      const durationMs = Date.now() - requestStart;
      this.log.error("request_failed", {
        stage: "request_error",
        provider: this.id,
        model: entry.id,
        endpoint: url,
        durationMs,
        error: (error as Error)?.message,
      });
      throw error;
    }

    const durationMs = Date.now() - requestStart;
    if (!res.ok) {
      const providerMessage = await this.extractProviderMessage(res);
      const requestIdHeader =
        res.headers.get("cf-aigc-request-id") ?? res.headers.get("x-request-id") ?? undefined;
      this.log.warn("response", {
        stage: "http_error",
        provider: this.id,
        model: entry.id,
        endpoint: url,
        httpStatus: res.status,
        content_type: res.headers.get("content-type") ?? undefined,
        requestId: requestIdHeader,
        durationMs,
        providerMessage,
      });
      throw classifyCloudflareFailure(res.status, providerMessage, {
        model: entry.id,
        providerRequestId: requestIdHeader,
        durationMs,
      });
    }

    this.log.info("response", {
      stage: "http_ok",
      provider: this.id,
      model: entry.id,
      endpoint: url,
      httpStatus: res.status,
      content_type: res.headers.get("content-type") ?? undefined,
      durationMs,
    });
    return res;
  }

  /** Build a log-safe copy of a request body, never including secrets. */
  private sanitizePayload(body: Record<string, unknown> | FormData): Record<string, unknown> {
    if (body instanceof FormData) {
      const out: Record<string, unknown> = {};
      for (const key of body.keys()) {
        out[key] = "<multipart-value>";
      }
      return out;
    }
    const clone = { ...(body as Record<string, unknown>) };
    for (const secret of ["api_token", "token", "apiToken", "authorization"]) {
      if (secret in clone) clone[secret] = "<redacted>";
    }
    return clone;
  }

  private async extractProviderMessage(res: Response): Promise<string | undefined> {
    try {
      const clone = res.clone();
      const json = (await clone.json().catch(() => null)) as {
        errors?: Array<{ message?: string }>;
      } | null;
      const first = json?.errors?.[0]?.message;
      if (first) return first;
    } catch {
      /* ignore — non-JSON error body */
    }
    return undefined;
  }

  private async parseImages(res: Response, entry: ImageModelRegistryEntry): Promise<string[]> {
    const contentType = res.headers.get("content-type") ?? "";

    // Binary image response (FLUX.2 returns raw bytes for the default format).
    if (contentType.startsWith("image/")) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const dataUrl = toDataUrl(contentType.split(";")[0].trim(), bytesToBase64(bytes));
      this.log.info("parse_image", {
        stage: "parsed_binary",
        provider: this.id,
        model: entry.id,
        format: contentType.split(";")[0].trim(),
        bytes: bytes.length,
      });
      return [dataUrl];
    }

    // JSON envelope: { success, result: { image | images[] | data[] | b64 } }.
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: Array<{ message?: string }>;
      result?: {
        image?: string;
        images?: Array<string | { b64_json?: string }>;
        data?: Array<{ b64_json?: string }>;
        b64?: string;
        image_b64?: string;
      };
    } | null;

    if (json?.success === false) {
      const providerMessage = json.errors?.[0]?.message;
      throw new ImageGenerationError(
        "MALFORMED_RESPONSE",
        providerMessage ?? "Cloudflare returned an unsuccessful response.",
        { model: entry.id, providerMessage },
      );
    }

    const result = json?.result;
    if (!result) {
      throw new ImageGenerationError("MALFORMED_RESPONSE", "Cloudflare returned no image result.", {
        model: entry.id,
      });
    }
    const mime = mimeFromDeclared(entry.declaredOutput);
    const found: string[] = [];
    if (typeof result.image === "string") found.push(result.image);
    if (typeof result.b64 === "string") found.push(result.b64);
    if (typeof result.image_b64 === "string") found.push(result.image_b64);
    if (Array.isArray(result.images)) {
      for (const item of result.images) {
        if (typeof item === "string") found.push(item);
        else if (item && typeof item.b64_json === "string") found.push(item.b64_json);
      }
    }
    if (Array.isArray(result.data)) {
      for (const item of result.data) {
        if (item && typeof item.b64_json === "string") found.push(item.b64_json);
      }
    }
    if (found.length === 0) {
      throw new ImageGenerationError(
        "MALFORMED_RESPONSE",
        "Cloudflare returned an unreadable image result.",
        { model: entry.id },
      );
    }
    this.log.info("parse_image", {
      stage: "parsed_json",
      provider: this.id,
      model: entry.id,
      format: mime,
      images: found.length,
    });
    return found.map((b64) => toDataUrl(mime, b64));
  }

  // -------------------------------------------------------------------------
  // Error helpers
  // -------------------------------------------------------------------------

  private classify(
    error: unknown,
    entry: ImageModelRegistryEntry,
    requestId: string,
    durationMs: number,
  ): ImageGenerationError {
    if (error instanceof ImageGenerationError) {
      return error;
    }
    if (isTimeoutLike(error)) {
      return new ImageGenerationError("TIMEOUT", "Cloudflare request timed out.", {
        model: entry.id,
        durationMs,
        hint: "Try again shortly or pick a faster model.",
      });
    }
    if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      return new ImageGenerationError("PROVIDER_ERROR", "Could not reach Cloudflare Workers AI.", {
        model: entry.id,
        durationMs,
        hint: "Check the server's network connectivity to api.cloudflare.com.",
      });
    }
    this.log.error("generate_unexpected_error", {
      model: entry.id,
      requestId,
      error: (error as Error)?.message,
    });
    return new ImageGenerationError("PROVIDER_ERROR", "Image generation failed unexpectedly.", {
      model: entry.id,
      durationMs,
    });
  }

  private backoffMs(error: ImageGenerationError, attempt: number): number {
    if (error.code === "RATE_LIMITED") return 1000 * attempt * attempt;
    return 400 * Math.pow(2, attempt - 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** The application-wide Cloudflare image provider. */
export const cloudflareImageProvider = new CloudflareImageProvider();
