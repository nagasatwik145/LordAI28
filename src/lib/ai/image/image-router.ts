// The image router: the single decision point for "turn this request into images".
//
// Responsibilities (spec §7): validate, select the model, call the provider,
// fall back *within Cloudflare only*, normalize the output, and produce a
// structured result the API layer can serialize as-is. The router depends on the
// {@link ImageProvider} interface, never on Cloudflare specifics, so the fallback
// chain can never silently switch providers.

import { cloudflareImageProvider } from "./cloudflare-provider";
import {
  DEFAULT_IMAGE_MODEL_ID,
  buildFallbackChain,
  getImageModel,
  getImageModelLabel,
  resolveConfiguredModelId,
  getImageModelProvider,
} from "./image-models";
import { generateOpenRouterImage } from "./openrouter-image-provider";
import { resolveModelDimensions } from "./image-capabilities";
import { getCachedImageHealth } from "./image-health";
import { enhanceImagePrompt } from "./image-prompt";
import { allModelsUnavailableError, ImageGenerationError, isTimeoutLike } from "./image-errors";
import { getConfiguredModelError, getImageEnvironmentError } from "./image-validation";
import type {
  ImageAttempt,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageQuality,
  ProviderGenerateRequest,
  ProviderGenerateResult,
} from "./image-types";
import { IMAGE_PROVIDER_ID, IMAGE_PROVIDER_LABEL } from "./image-types";

const MAX_IMAGES_PER_REQUEST = 4;
const DEFAULT_QUALITY: ImageQuality = "balanced";

function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function clampCount(raw: number | undefined): number {
  const value = Number.isFinite(raw) ? Math.floor(raw as number) : 1;
  return Math.min(MAX_IMAGES_PER_REQUEST, Math.max(1, value || 1));
}

function makeSuccessAttempt(
  model: string,
  modelLabel: string,
  result: ProviderGenerateResult,
): ImageAttempt {
  return {
    model,
    modelLabel,
    ok: true,
    status: 200,
    retries: result.retryCount,
    durationMs: result.generationTimeMs,
  };
}

function makeFailureAttempt(
  model: string,
  modelLabel: string,
  error: ImageGenerationError,
): ImageAttempt {
  return {
    model,
    modelLabel,
    ok: false,
    status: error.status,
    code: error.code,
    reason: error.message,
    retries: 0,
    durationMs: error.durationMs ?? 0,
  };
}

function toGenerationError(error: unknown, requestId: string): ImageGenerationError {
  if (error instanceof ImageGenerationError) return error;
  if (isTimeoutLike(error)) {
    return new ImageGenerationError("TIMEOUT", "The image request timed out.", { durationMs: 0 });
  }
  return new ImageGenerationError("PROVIDER_ERROR", "Image generation failed.", {});
}

/** A health-derived filter so the chain skips models Cloudflare marked unhealthy. */
function selectableFilter(): ((entry: { id: string }) => boolean) | undefined {
  const health = getCachedImageHealth();
  if (!health) return undefined;
  const healthy = new Set(health.models.filter((m) => m.healthy).map((m) => m.model));
  return (entry) => healthy.has(entry.id);
}

export async function routeImageRequest(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const requestId = newRequestId();

  // --- Pre-flight validation (spec §5, §6): fail fast, before any request ---
  const envError = getImageEnvironmentError();
  if (envError) throw envError;
  const configuredModelError = getConfiguredModelError();
  if (configuredModelError) throw configuredModelError;

  // --- Validation (spec §9: clean, typed errors, never leak internals) ---
  if (!request.prompt || request.prompt.trim().length === 0) {
    throw new ImageGenerationError(
      "INVALID_REQUEST",
      "A prompt is required to generate an image.",
      {
        model: request.model,
      },
    );
  }

  const requestedModel = request.model && getImageModel(request.model) ? request.model : null;
  const effectiveRequested =
    requestedModel ?? resolveConfiguredModelId(process.env.CLOUDFLARE_IMAGE_MODEL).id;
  const quality: ImageQuality = request.quality ?? DEFAULT_QUALITY;
  const count = clampCount(request.count);

  const enhanced = enhanceImagePrompt(
    request.prompt,
    request.enhancePrompt ?? true,
    request.profile,
  );
  const finalPrompt = enhanced.prompt;

  const configuredModel = resolveConfiguredModelId(process.env.CLOUDFLARE_IMAGE_MODEL).id;
  const allCandidates = buildFallbackChain({
    preferred: configuredModel,
    isSelectable: selectableFilter(),
  });
  // Cloudflare is always preferred. OpenRouter is reached only after every
  // Cloudflare candidate failed, even if a previous request selected it.
  const chain = [
    ...allCandidates.filter((entry) => getImageModelProvider(entry.id) === "cloudflare"),
    ...(requestedModel && getImageModelProvider(requestedModel) === "openrouter"
      ? allCandidates.filter((entry) => entry.id === requestedModel)
      : []),
    ...allCandidates.filter(
      (entry) => getImageModelProvider(entry.id) === "openrouter" && entry.id !== requestedModel,
    ),
  ];

  const attempts: ImageAttempt[] = [];
  const images: string[] = [];
  let totalRetries = 0;
  let usedModel: string | null = null;
  let usedEntry: ReturnType<typeof getImageModel>;
  const queueStart = Date.now();

  for (const entry of chain) {
    const dims = resolveModelDimensions(entry, {
      width: request.width,
      height: request.height,
      aspectRatio: request.aspectRatio,
    });
    const genRequest: ProviderGenerateRequest = {
      requestId,
      model: entry.id,
      prompt: finalPrompt,
      negativePrompt: request.negativePrompt,
      width: dims.width,
      height: dims.height,
      aspectRatio: dims.aspectRatio,
      quality,
      seed: request.seed,
      count: 1,
    };

    let first: ProviderGenerateResult;
    try {
      first =
        getImageModelProvider(entry.id) === "openrouter"
          ? await generateOpenRouterImage(genRequest)
          : await cloudflareImageProvider.generate(genRequest);
    } catch (error) {
      attempts.push(makeFailureAttempt(entry.id, entry.label, toGenerationError(error, requestId)));
      continue;
    }
    attempts.push(makeSuccessAttempt(entry.id, entry.label, first));
    images.push(...first.images);
    totalRetries += first.retryCount;

    // Generate the remaining images on the same (already-selected) model.
    for (let i = 1; i < count && images.length < count; i += 1) {
      const repeat: ProviderGenerateRequest = {
        ...genRequest,
        seed: request.seed ?? Math.floor(Math.random() * 4_294_967_295),
      };
      try {
        const extra =
          getImageModelProvider(entry.id) === "openrouter"
            ? await generateOpenRouterImage(repeat)
            : await cloudflareImageProvider.generate(repeat);
        images.push(...extra.images);
        totalRetries += extra.retryCount;
        attempts.push(makeSuccessAttempt(entry.id, entry.label, extra));
      } catch (error) {
        attempts.push(
          makeFailureAttempt(entry.id, entry.label, toGenerationError(error, requestId)),
        );
      }
    }

    usedModel = entry.id;
    usedEntry = entry;
    break;
  }

  if (!usedModel || !usedEntry) {
    throw allModelsUnavailableError();
  }

  const queueTimeMs = queueStart - Date.now();
  const generationTimeMs = attempts.filter((a) => a.ok).reduce((sum, a) => sum + a.durationMs, 0);
  const fallbackUsed = usedModel !== effectiveRequested;
  const fallbackCount = chain.findIndex((e) => e.id === usedModel);

  const dims = resolveModelDimensions(usedEntry, {
    width: request.width,
    height: request.height,
    aspectRatio: request.aspectRatio,
  });

  return {
    provider: getImageModelProvider(usedModel) ?? IMAGE_PROVIDER_ID,
    providerLabel:
      getImageModelProvider(usedModel) === "openrouter" ? "OpenRouter" : IMAGE_PROVIDER_LABEL,
    requestId,
    model: usedModel,
    modelLabel: getImageModelLabel(usedModel),
    requestedModel: effectiveRequested,
    requestedModelLabel: getImageModelLabel(effectiveRequested),
    fallbackUsed,
    fallbackCount: fallbackUsed ? fallbackCount : 0,
    retryCount: totalRetries,
    images: images.slice(0, count),
    prompt: request.prompt,
    enhancedPrompt: finalPrompt,
    negativePrompt: request.negativePrompt,
    width: dims.width,
    height: dims.height,
    aspectRatio: dims.aspectRatio,
    seed: request.seed,
    quality,
    queueTimeMs: Math.max(0, queueTimeMs),
    generationTimeMs,
    estimatedCost: usedEntry.estimatedCost * images.length,
    attempts,
  };
}
