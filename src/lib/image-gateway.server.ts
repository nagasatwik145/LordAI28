import { GATEWAY_CONFIG } from "./gateway-config";
import { createLogger } from "./gateway-logger";
import { getGatewayInfrastructure, validateApiKey } from "./ai-gateway.server";
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  IMAGE_MODELS,
  type ImageModelDefinition,
} from "./lord-config";
import { enhanceImagePrompt, type ImagePromptProfile } from "./image-prompt";

// OpenRouter's dedicated Images API; image generation must not use chat/completions.
const IMAGES_URL = "https://openrouter.ai/api/v1/images";
const IMAGE_MODELS_URL = "https://openrouter.ai/api/v1/images/models";

export type ImageGenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  quality?: "fast" | "balanced" | "high";
  model?: string;
  count?: number;
  enhancePrompt?: boolean;
  profile?: ImagePromptProfile;
  sourceImageUrl?: string;
  editInstruction?: string;
};
export type ImageGenerationResult = {
  imageUrl: string;
  model: string;
  provider: string;
  generationTime: number;
  revisedPrompt?: string;
  seed?: number;
  width: number;
  height: number;
  enhancedPrompt: string;
  queueTime: number;
  retryCount: number;
  fallbackCount: number;
  estimatedCost: number;
};
type ErrorCode =
  | "IMAGE_GENERATION_FAILED"
  | "MODEL_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "INVALID_PROMPT"
  | "TIMEOUT"
  | "CONTENT_BLOCKED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "MISSING_API_KEY";

export class ImageGatewayError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly reason = message,
  ) {
    super(message);
  }
}
type RemoteModel = {
  id: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[] | Record<string, unknown>;
};
let discovery: Promise<Map<string, RemoteModel>> | null = null;
let startup: Promise<void> | null = null;

const dim = (value: number | undefined, max: number) =>
  Math.min(max, Math.max(256, Math.round((value ?? 1024) / 64) * 64));
const aspectRatio = (width: number, height: number) => {
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / a}:${height / a}`;
};
const params = (model: RemoteModel) =>
  new Set(
    Array.isArray(model.supported_parameters)
      ? model.supported_parameters
      : Object.keys(model.supported_parameters ?? {}),
  );
function providerDetail(body: string) {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    return typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
  } catch {
    return undefined;
  }
}
function classify(status: number, body: string) {
  const detail = (providerDetail(body) ?? body).toLowerCase();
  if (status === 401)
    return new ImageGatewayError(
      "UNAUTHORIZED",
      "OpenRouter rejected the API key.",
      401,
      false,
      "401 Unauthorized",
    );
  if (status === 403)
    return new ImageGatewayError(
      "FORBIDDEN",
      "OpenRouter denied this image request.",
      403,
      false,
      "403 Forbidden",
    );
  if (status === 429)
    return new ImageGatewayError(
      "PROVIDER_RATE_LIMITED",
      "The image provider is rate limited. Please try again shortly.",
      429,
      true,
      "429 Rate limited",
    );
  if (status === 404)
    return new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The selected image model is unavailable.",
      404,
      false,
      "404 Model unavailable",
    );
  if (status === 402 || detail.includes("quota") || detail.includes("credit"))
    return new ImageGatewayError(
      "IMAGE_GENERATION_FAILED",
      "Image generation quota has been exceeded.",
      402,
      false,
      "Quota exceeded",
    );
  if (detail.includes("safety") || detail.includes("policy") || detail.includes("moderation"))
    return new ImageGatewayError(
      "CONTENT_BLOCKED",
      "This prompt cannot be used to generate an image.",
      422,
      false,
      "Content blocked",
    );
  if (status === 400 || status === 422)
    return new ImageGatewayError(
      "INVALID_PROMPT",
      "The image request was rejected by the selected model.",
      status,
      false,
      "Invalid request body",
    );
  if (status >= 500)
    return new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The image provider is temporarily unavailable.",
      status,
      true,
      "Provider unavailable",
    );
  return new ImageGatewayError(
    "IMAGE_GENERATION_FAILED",
    "Image generation failed. Please try again.",
    502,
    true,
    "Provider error",
  );
}
function imageFrom(payload: unknown) {
  const root = payload as {
    data?: Array<{ url?: string; b64_json?: string; media_type?: string; revised_prompt?: string }>;
    images?: Array<{ url?: string }>;
    revised_prompt?: string;
  };
  const image = root.data?.[0];
  return {
    url:
      image?.url ??
      (image?.b64_json
        ? `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`
        : root.images?.[0]?.url),
    revisedPrompt: image?.revised_prompt ?? root.revised_prompt,
  };
}
async function discover() {
  if (discovery) return discovery;
  discovery = (async () => {
    const response = await fetch(IMAGE_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(GATEWAY_CONFIG.startupValidationTimeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) throw classify(response.status, raw);
    return new Map(
      ((JSON.parse(raw) as { data?: RemoteModel[] }).data ?? []).map((model) => [model.id, model]),
    );
  })().catch((error) => {
    discovery = null;
    throw error;
  });
  return discovery;
}

/** Catalog-only startup validation: does not create billable images. */
export async function validateImageModelsAtStartup() {
  const infra = getGatewayInfrastructure(createLogger(GATEWAY_CONFIG));
  console.info("IMAGE CONFIGURATION");
  if (!validateApiKey(process.env.OPENROUTER_API_KEY).valid) {
    for (const m of IMAGE_MODELS) {
      infra.healthCache.set({
        provider: m.provider,
        model: m.id,
        status: "missing_api_key",
        reason: "Missing OPENROUTER_API_KEY",
        timestamp: Date.now(),
        expiresAt: Date.now() + infra.healthCache.getTtlForStatus(401),
        httpStatus: 401,
        retryable: false,
      });
      console.info(`✖ ${m.label}\n  Reason: Missing OPENROUTER_API_KEY`);
    }
    return;
  }
  try {
    const catalog = await discover();
    for (const m of IMAGE_MODELS) {
      const valid = catalog.get(m.id)?.architecture?.output_modalities?.includes("image");
      const reason = valid ? "" : "404 model unavailable";
      infra.healthCache.set({
        provider: m.provider,
        model: m.id,
        status: valid ? "healthy" : "invalid",
        reason,
        timestamp: Date.now(),
        expiresAt:
          Date.now() +
          (valid ? GATEWAY_CONFIG.healthCacheDefaultTtlMs : infra.healthCache.getTtlForStatus(404)),
        httpStatus: valid ? undefined : 404,
        retryable: false,
      });
      console.info(
        `${valid ? "✔" : "✖"} ${m.label}${valid ? "" : "\n  Reason: 404 model unavailable"}`,
      );
    }
  } catch (error) {
    const safe =
      error instanceof ImageGatewayError
        ? error
        : new ImageGatewayError(
            "IMAGE_GENERATION_FAILED",
            "Unable to validate image configuration.",
            502,
            true,
            "Provider unavailable",
          );
    infra.logger.error("image_provider_error", {
      stage: "startup_validation",
      status: safe.status,
      reason: safe.reason,
    });
  }
}
function ensureStartup() {
  startup ??= validateImageModelsAtStartup();
  return startup;
}
if (GATEWAY_CONFIG.startupValidationEnabled) void ensureStartup();
function payload(
  input: ImageGenerationRequest,
  model: ImageModelDefinition,
  remote: RemoteModel,
  prompt: string,
  width: number,
  height: number,
) {
  const supported = params(remote);
  const quality =
    input.quality === "fast" ? "low" : input.quality === "balanced" ? "medium" : input.quality;
  const out: Record<string, unknown> = { model: model.id, prompt };
  // Do not send undocumented response_format, width, height, steps, or negative_prompt.
  if (supported.has("size")) out.size = `${width}x${height}`;
  else if (supported.has("resolution"))
    out.resolution = width >= 2048 && height >= 2048 ? "2K" : "1K";
  if (supported.has("aspect_ratio")) out.aspect_ratio = aspectRatio(width, height);
  if (quality && supported.has("quality")) out.quality = quality;
  if (input.seed !== undefined && supported.has("seed")) out.seed = input.seed;
  if (input.sourceImageUrl && supported.has("input_references"))
    out.input_references = [input.sourceImageUrl];
  return out;
}

export async function generateImageWithFallback(
  input: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const requestId = crypto.randomUUID();
  const infra = getGatewayInfrastructure(createLogger(GATEWAY_CONFIG));
  const logger = infra.logger;
  logger.info("image_request_started", {
    requestId,
    requestedModel: input.model ?? DEFAULT_IMAGE_MODEL_ID,
    promptLength: input.prompt.length,
  });
  const requested = getImageModel(input.model);
  if (input.model && !requested)
    throw new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The selected image model is not registered.",
      400,
      false,
      "Invalid model",
    );
  if (!validateApiKey(process.env.OPENROUTER_API_KEY).valid)
    throw new ImageGatewayError(
      "MISSING_API_KEY",
      "Missing OPENROUTER_API_KEY. Configure it on the server and in Vercel.",
      503,
      false,
      "Missing OPENROUTER_API_KEY",
    );
  logger.info("image_request_validated", {
    requestId,
    model: requested?.id ?? DEFAULT_IMAGE_MODEL_ID,
  });
  await ensureStartup();
  const catalog = await discover();
  const candidates = requested
    ? [requested, ...IMAGE_MODELS.filter((m) => m.id !== requested.id)]
    : [...IMAGE_MODELS];
  const enhanced = enhanceImagePrompt(input.prompt, input.enhancePrompt !== false, input.profile);
  let last = new ImageGatewayError(
    "MODEL_UNAVAILABLE",
    "No image model is currently available.",
    503,
    true,
    "No healthy model",
  );
  let fallbackCount = 0;
  for (const model of candidates) {
    const remote = catalog.get(model.id);
    const health = infra.healthCache.get(model.provider, model.id);
    if (
      !remote ||
      !remote.architecture?.output_modalities?.includes("image") ||
      (health && health.status !== "healthy") ||
      infra.circuitBreaker.isOpen(model.provider, model.id)
    ) {
      logger.warn("image_provider_fallback", {
        requestId,
        model: model.id,
        reason: health?.reason ?? "Model unavailable",
      });
      continue;
    }
    if (input.sourceImageUrl && !params(remote).has("input_references")) continue;
    const width = dim(input.width, model.maxWidth),
      height = dim(input.height, model.maxHeight),
      body = payload(input, model, remote, enhanced.prompt, width, height);
    logger.info("image_provider_selected", { requestId, provider: "OpenRouter", model: model.id });
    for (let attempt = 0; attempt < 2; attempt++)
      try {
        const started = performance.now();
        logger.info("image_provider_request", {
          requestId,
          endpoint: "/api/v1/images",
          model: model.id,
          attempt,
          authorization: "Bearer [configured]",
          contentType: "application/json",
          payload: { ...body, prompt: `[redacted length=${enhanced.prompt.length}]` },
        });
        const response = await fetch(IMAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://lordai.app",
            "X-Title": process.env.OPENROUTER_TITLE || "LordAI",
          },
          signal: AbortSignal.timeout(GATEWAY_CONFIG.providerTimeouts.openrouter),
          body: JSON.stringify(body),
        });
        const raw = await response.text();
        logger.info("image_provider_response", {
          requestId,
          model: model.id,
          status: response.status,
          ok: response.ok,
          latencyMs: Math.round(performance.now() - started),
          hasImage: response.ok && raw.includes("b64_json"),
        });
        if (!response.ok) throw classify(response.status, raw);
        const image = imageFrom(JSON.parse(raw));
        if (!image.url)
          throw new ImageGatewayError(
            "IMAGE_GENERATION_FAILED",
            "The provider returned no image.",
            502,
            true,
            "No image returned",
          );
        const generationTime = Math.round(performance.now() - started);
        infra.healthCache.set({
          provider: model.provider,
          model: model.id,
          status: "healthy",
          reason: "",
          timestamp: Date.now(),
          expiresAt: Date.now() + GATEWAY_CONFIG.healthCacheDefaultTtlMs,
        });
        infra.circuitBreaker.recordSuccess(model.provider, model.id);
        logger.info("image_generation_complete", {
          requestId,
          model: model.id,
          provider: "OpenRouter",
          generationTime,
          fallbackCount,
          retryCount: attempt,
        });
        return {
          imageUrl: image.url,
          model: model.id,
          provider: "OpenRouter",
          generationTime,
          revisedPrompt: image.revisedPrompt,
          seed: input.seed,
          width,
          height,
          enhancedPrompt: image.revisedPrompt ?? enhanced.prompt,
          queueTime: 0,
          retryCount: attempt,
          fallbackCount,
          estimatedCost: model.estimatedPrice,
        };
      } catch (error) {
        last =
          error instanceof ImageGatewayError
            ? error
            : new ImageGatewayError(
                error instanceof DOMException && error.name === "TimeoutError"
                  ? "TIMEOUT"
                  : "IMAGE_GENERATION_FAILED",
                error instanceof DOMException && error.name === "TimeoutError"
                  ? "The image provider timed out."
                  : "Image generation failed. Please try again.",
                502,
                true,
                error instanceof DOMException && error.name === "TimeoutError"
                  ? "Network timeout"
                  : "Network error",
              );
        logger.warn("image_provider_error", {
          requestId,
          model: model.id,
          status: last.status,
          code: last.code,
          reason: last.reason,
          retryable: last.retryable,
        });
        if (last.retryable && attempt === 0) {
          logger.info("image_provider_retry", { requestId, model: model.id, attempt: 1 });
          continue;
        }
        infra.circuitBreaker.recordFailure(model.provider, model.id);
        infra.healthCache.set({
          provider: model.provider,
          model: model.id,
          status: last.status === 429 ? "rate_limited" : last.retryable ? "unavailable" : "invalid",
          reason: last.reason,
          timestamp: Date.now(),
          expiresAt: Date.now() + infra.healthCache.getTtlForStatus(last.status),
          httpStatus: last.status,
          retryable: last.retryable,
        });
        if (!last.retryable) throw last;
      }
    fallbackCount++;
  }
  throw last;
}
export { DEFAULT_IMAGE_MODEL_ID };
