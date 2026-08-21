// Client-side Image Gateway — orchestrates the provider fallback chain.
//
//   Puter → Cloudflare → OpenRouter → (other healthy providers)
//
// Puter runs in the browser; Cloudflare/OpenRouter run on the server via the
// existing `/api/images` endpoint. This module is the single place that decides
// order, health, retries, and fallback so the UI never has to. Every result is
// normalized to `UnifiedImageResult` (see providers/types.ts).
//
// It reuses the existing `/api/images` server gateway unchanged — that endpoint
// remains the authoritative server-side generator and already persists images
// to the gallery/database. Only Puter-generated images are persisted separately
// (via /api/images/persist) so we never double-write.

import { authenticatedFetch } from "./authenticated-fetch";
import { getApiBaseUrl } from "./api-config";
import { puterProvider, PuterProviderError } from "./providers/puter-provider";
import { imageLogger } from "./image-logger";
import {
  IMAGE_PROVIDER_ORDER,
  isClientProvider,
  resolveProviderOrder,
} from "./image-provider-registry";
import type {
  GenerateImageParams,
  ImageProviderId,
  ProviderHealth,
  UnifiedImageResult,
} from "./providers/types";
import {
  enhanceImagePrompt,
  inferImagePromptProfile,
  type ImagePromptProfile,
} from "./image-prompt";

export type ImageGatewaySelection = "auto" | ImageProviderId;

export interface ImageGatewayRequest {
  prompt: string;
  provider?: ImageGatewaySelection;
  model?: string;
  quality?: "fast" | "balanced" | "high";
  aspectRatio?: string;
  width?: number;
  height?: number;
  count?: number;
  seed?: number;
  enhancePrompt?: boolean;
  negativePrompt?: string;
  profile?: ImagePromptProfile;
  conversationId?: string | null;
  projectId?: string | null;
  /** Editing: a previously generated image to transform (OpenRouter only today). */
  sourceImageUrl?: string;
  editInstruction?: string;
}

export class ImageGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly authRequired = false,
  ) {
    super(message);
    this.name = "ImageGatewayError";
  }
}

function toGenerateParams(req: ImageGatewayRequest): GenerateImageParams {
  const enhance = req.enhancePrompt !== false;
  const enhancedPrompt = enhance
    ? enhanceImagePrompt(req.prompt, true, req.profile ?? inferImagePromptProfile(req.prompt))
        .prompt
    : req.prompt;
  return {
    prompt: req.prompt,
    enhancedPrompt,
    model: req.model,
    aspectRatio: req.aspectRatio,
    width: req.width,
    height: req.height,
    quality: req.quality,
    count: req.count,
    seed: req.seed,
    negativePrompt: req.negativePrompt,
  };
}

async function callServerProvider(
  id: ImageProviderId,
  req: ImageGatewayRequest,
): Promise<UnifiedImageResult> {
  const res = await authenticatedFetch(`${getApiBaseUrl()}/api/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: req.prompt,
      provider: id,
      model: req.model,
      quality: req.quality,
      width: req.width,
      height: req.height,
      count: req.count,
      seed: req.seed,
      negativePrompt: req.negativePrompt,
      enhancePrompt: req.enhancePrompt,
      profile: req.profile ?? inferImagePromptProfile(req.prompt),
      conversationId: req.conversationId ?? undefined,
      projectId: req.projectId ?? undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && (body?.imageUrl || (body?.images?.length ?? 0) > 0)) {
    return {
      provider: body.provider ?? id,
      model: body.model ?? req.model ?? "unknown",
      images: body.images ?? (body.imageUrl ? [body.imageUrl] : []),
      generationTime: body.generationTime ?? 0,
      cost: body.estimatedCost ?? 0,
      requestId: crypto.randomUUID(),
      diagnostics: {
        provider: body.provider ?? id,
        model: body.model ?? req.model ?? "unknown",
        modelLabel: body.modelLabel,
        fallbackUsed: Boolean(body.fallbackUsed),
        fallbackProvider: body.fallbackUsed ? body.provider : undefined,
        fallbackModel: body.fallbackUsed ? body.model : undefined,
        retryCount: 0,
        queueTimeMs: 0,
        generationTimeMs: body.generationTime ?? 0,
        persistenceWarning: body.persisted === false,
      },
    };
  }
  const code = body?.error?.code ?? "GENERATION_FAILED";
  const terminal = code === "CONTENT_BLOCKED" || code === "INVALID_PROMPT";
  const err = new ImageGatewayError(
    code,
    body?.error?.message ?? body?.message ?? "Image generation failed.",
  );
  (err as ImageGatewayError & { retryable?: boolean; hint?: string }).retryable = !terminal;
  (err as ImageGatewayError & { retryable?: boolean; hint?: string }).hint = body?.error?.hint;
  throw err;
}

export async function generateImageWithGateway(
  req: ImageGatewayRequest,
): Promise<UnifiedImageResult> {
  const requestId = crypto.randomUUID();
  const order = resolveProviderOrder(req.provider ?? "auto");
  imageLogger.requestStarted(requestId, req.provider ?? "auto", req.prompt.length);

  let fallbackCount = 0;
  let lastError: ImageGatewayError | PuterProviderError | null = null;

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    imageLogger.providerAttempt(requestId, id);
    try {
      if (isClientProvider(id)) {
        const health = await puterProvider.healthCheck();
        if (health.status === "auth_required") {
          // Explicit Puter selection → surface login. Auto → skip to server.
          if (req.provider === "puter") {
            imageLogger.authRequired(requestId, id);
            throw new PuterProviderError(
              "AUTH_REQUIRED",
              "Sign in with Puter to use free image generation.",
            );
          }
          const next = order[i + 1] ?? "none";
          imageLogger.providerFallback(requestId, id, next, "auth_required");
          continue;
        }
        if (!health.available) {
          const next = order[i + 1] ?? "none";
          imageLogger.providerFallback(requestId, id, next, health.reason ?? "unavailable");
          continue;
        }
        const result = await puterProvider.generateImage(toGenerateParams(req));
        imageLogger.providerSuccess(
          requestId,
          result.provider,
          result.model,
          result.generationTime,
          result.images.length,
          0,
        );
        imageLogger.requestComplete(
          requestId,
          result.provider,
          result.generationTime,
          fallbackCount,
          result.cost,
        );
        return result;
      }

      const result = await callServerProvider(id, req);
      imageLogger.providerSuccess(
        requestId,
        result.provider,
        result.model,
        result.generationTime,
        result.images.length,
        0,
      );
      imageLogger.requestComplete(
        requestId,
        result.provider,
        result.generationTime,
        fallbackCount,
        result.cost,
      );
      return result;
    } catch (error) {
      const code =
        error instanceof PuterProviderError
          ? error.code
          : error instanceof ImageGatewayError
            ? error.code
            : "GENERATION_FAILED";
      const retryable =
        error instanceof PuterProviderError
          ? error.code !== "AUTH_REQUIRED" && error.code !== "CONTENT_BLOCKED"
          : ((error as ImageGatewayError & { retryable?: boolean })?.retryable ?? true);
      const message = error instanceof Error ? error.message : "Image generation failed.";
      const authRequired = error instanceof PuterProviderError && error.code === "AUTH_REQUIRED";
      imageLogger.providerError(requestId, id, code, retryable);
      lastError =
        error instanceof PuterProviderError
          ? error
          : new ImageGatewayError(code, message, authRequired);

      if (retryable && i < order.length - 1) {
        fallbackCount++;
        const next = order[i + 1];
        imageLogger.providerFallback(requestId, id, next, code);
        continue;
      }
      // Terminal error — stop and report.
      imageLogger.requestFailed(requestId, id, code);
      if (error instanceof PuterProviderError && error.code === "AUTH_REQUIRED") {
        throw new ImageGatewayError("AUTH_REQUIRED", error.message, true);
      }
      throw lastError;
    }
  }

  imageLogger.requestFailed(requestId, order[order.length - 1], "no_provider");
  throw new ImageGatewayError(
    "NO_PROVIDER",
    "No image provider is available right now. Please try again later.",
  );
}

/** Snapshot of provider health, used by the UI to show status + login prompts. */
export async function checkImageProviderHealth(): Promise<Record<ImageProviderId, ProviderHealth>> {
  const out = {} as Record<ImageProviderId, ProviderHealth>;
  for (const id of IMAGE_PROVIDER_ORDER) {
    if (isClientProvider(id)) {
      out[id] = await puterProvider.healthCheck();
    } else {
      // Server providers are considered available; the server gateway tracks
      // real per-model health internally.
      out[id] = {
        status: "available",
        authenticated: false,
        available: true,
        rateLimited: false,
        checkedAt: Date.now(),
      };
    }
  }
  return out;
}

export { puterProvider };
