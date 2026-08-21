import { readEnvApiKey } from "../../env.server";
import { ImageGenerationError } from "./image-errors";
import { getImageModel, getImageModelParams } from "./image-models";
import type { ProviderGenerateRequest, ProviderGenerateResult } from "./image-types";

const BASE_URL = "https://openrouter.ai/api/v1/images/generations";
const TIMEOUT_MS = 30_000;

function asDataUrl(value: string): string {
  return value.startsWith("data:") ? value : value;
}

/** OpenRouter's image endpoint. Only registry-approved fields are serialized. */
export async function generateOpenRouterImage(
  request: ProviderGenerateRequest,
): Promise<ProviderGenerateResult> {
  const key = readEnvApiKey("OPENROUTER_API_KEY");
  if (!key) {
    throw new ImageGenerationError("MISSING_CREDENTIALS", "OpenRouter configuration missing.", {
      hint: "Set OPENROUTER_API_KEY on the server.",
      model: request.model,
    });
  }
  const entry = getImageModel(request.model);
  const params = getImageModelParams(request.model);
  const body: Record<string, unknown> = { model: request.model, prompt: request.prompt };
  if (params.has("aspect_ratio") && request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (params.has("seed") && request.seed !== undefined) body.seed = request.seed;
  if (params.has("quality"))
    body.quality =
      request.quality === "fast" ? "low" : request.quality === "high" ? "high" : "medium";
  if (params.has("resolution")) body.resolution = request.quality === "high" ? "2K" : "1K";

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timeout =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new ImageGenerationError(
      timeout ? "TIMEOUT" : "PROVIDER_ERROR",
      timeout ? "OpenRouter image request timed out." : "Could not reach OpenRouter.",
      { model: request.model },
    );
  }
  if (!response.ok) {
    const status = response.status;
    const code =
      status === 401 || status === 403
        ? "INVALID_CREDENTIALS"
        : status === 429
          ? "RATE_LIMITED"
          : status === 400
            ? "INVALID_REQUEST"
            : status === 404
              ? "MODEL_UNAVAILABLE"
              : "PROVIDER_ERROR";
    throw new ImageGenerationError(code, `OpenRouter image request failed (${status}).`, {
      status,
      model: request.model,
    });
  }
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const images = (payload.data ?? []).flatMap((item) =>
    item.b64_json
      ? [`data:image/png;base64,${item.b64_json}`]
      : item.url
        ? [asDataUrl(item.url)]
        : [],
  );
  if (images.length === 0)
    throw new ImageGenerationError("MALFORMED_RESPONSE", "OpenRouter returned no image data.", {
      model: request.model,
    });
  return {
    provider: "openrouter",
    model: request.model,
    images,
    width: request.width,
    height: request.height,
    seed: request.seed,
    retryCount: 0,
    generationTimeMs: Date.now() - startedAt,
    contractSource: "registry",
    inputMode: entry?.inputMode ?? "json",
  };
}
