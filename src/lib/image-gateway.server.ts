import { GATEWAY_CONFIG, IMAGE_CONFIG } from "./gateway-config";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single provider parameter, as declared by the OpenRouter model catalog. */
type ParamSchema =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

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

/** One provider round-trip, surfaced to the UI so it can show what was tried. */
export type ImageAttempt = {
  model: string;
  provider: string;
  status: number;
  reason: string;
  retryable: boolean;
  fatal: boolean;
  providerMessage?: string;
  errorCode?: string;
  requestId?: string;
};

export type ImageHealthStatus =
  | "healthy"
  | "unavailable"
  | "rate_limited"
  | "invalid"
  | "missing_api_key"
  | "unknown"
  | "quota"
  | "auth_failed"
  | "timeout"
  | "unsupported";

export type ImageModelCapabilityReport = {
  id: string;
  label: string;
  exists: boolean;
  available: boolean;
  supportsGeneration: boolean;
  supportsAspectRatio: boolean;
  supportsQuality: boolean;
  supportsSeed: boolean;
  supportsResolution: boolean;
  supportsNegativePrompt: boolean;
  supportsEditing: boolean;
  supportsEnhancePrompt: boolean;
  maxImagesPerRequest: number;
  declaredMaxImages: number;
  issues: string[];
  status: ImageHealthStatus;
  reason: string;
  resolutionTiers?: string[];
  qualityLevels?: string[];
  aspectRatios?: string[];
  message?: string;
};

export type ImageModelValidation = {
  valid: boolean;
  issues: string[];
  models: ImageModelCapabilityReport[];
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
  | "MISSING_API_KEY"
  | "QUOTA_EXCEEDED"
  | "MODEL_REJECTED_PARAMS";

export class ImageGatewayError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly reason = message,
    public readonly fatal = false,
    public readonly providerMessage?: string,
    public readonly hint?: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Catalog (live model schema) cache
// ---------------------------------------------------------------------------

type RemoteModel = {
  id: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: Record<string, ParamSchema> | string[];
  pricing?: Record<string, unknown>;
};

let catalogPromise: Promise<Map<string, RemoteModel>> | null = null;
let catalogCachedAt = 0;

function normalizeParams(raw: RemoteModel["supported_parameters"]): Record<string, ParamSchema> {
  if (Array.isArray(raw)) {
    const out: Record<string, ParamSchema> = {};
    for (const key of raw) out[key] = { type: "boolean" };
    return out;
  }
  return (raw ?? {}) as Record<string, ParamSchema>;
}

function parseCatalog(body: string): Map<string, RemoteModel> {
  const parsed = JSON.parse(body) as { data?: unknown };
  const list = (Array.isArray(parsed.data) ? parsed.data : []) as RemoteModel[];
  const map = new Map<string, RemoteModel>();
  for (const m of list) if (m.id) map.set(m.id, m);
  return map;
}

/**
 * Fetches and caches the OpenRouter image-model catalog. The catalog is the
 * single source of truth for what parameters each model accepts; the gateway
 * never hard-codes enum values. Cached for {@link IMAGE_CONFIG.catalogTtlMs}
 * and re-used across requests within a process.
 */
export async function discoverImageModels(force = false): Promise<Map<string, RemoteModel>> {
  const fresh = catalogPromise && Date.now() - catalogCachedAt < IMAGE_CONFIG.catalogTtlMs;
  if (fresh && !force) return catalogPromise!;
  if (catalogPromise && !force) return catalogPromise;

  catalogPromise = (async () => {
    const response = await fetch(IMAGE_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(IMAGE_CONFIG.catalogTimeoutMs),
    });
    const raw = await response.text();
    if (!response.ok) throw classify(response.status, raw);
    const map = parseCatalog(raw);
    catalogCachedAt = Date.now();
    return map;
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

/** Test/test helper: prime the catalog without a network call. */
export function __setImageCatalog(map: Map<string, RemoteModel>): void {
  catalogPromise = Promise.resolve(map);
  catalogCachedAt = Date.now();
}

/** Test helper: clear cached catalog/startup state. */
export function __resetImageGateway(): void {
  catalogPromise = null;
  catalogCachedAt = 0;
  startupValidated = false;
  startupPromise = null;
}

// Pure helpers exported for unit tests (no network, no secrets).
export const __test = {
  buildPayload,
  classify,
  repairPayload,
  capabilityReport,
};

// ---------------------------------------------------------------------------
// Payload building & repair (catalog-driven, no hard-coded enums)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (base: number) => Math.round(base * (0.75 + Math.random() * 0.5));

const QUALITY_RANK = { low: 0, medium: 1, high: 2, auto: 1 } as const;
const QUALITY_TO_ENUM: Record<"fast" | "balanced" | "high", string> = {
  fast: "low",
  balanced: "medium",
  high: "high",
};

function dim(value: number | undefined, max: number): number {
  const base = Math.min(max, Math.max(256, Math.round((value ?? 1024) / 64) * 64));
  return Math.max(256, Math.min(max, base));
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function nearestAspectRatio(value: string, options: string[]): string | null {
  const parsed = value.split(":").map(Number);
  if (parsed.length !== 2 || parsed.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  const target = parsed[0] / parsed[1];
  let best: string | null = null;
  let bestDist = Infinity;
  for (const option of options) {
    const parts = option.split(":").map(Number);
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) continue;
    const ratio = parts[0] / parts[1];
    const dist = Math.abs(Math.log(target / ratio));
    if (dist < bestDist) {
      bestDist = dist;
      best = option;
    }
  }
  return best;
}

function resolutionTier(width: number, height: number): number {
  // Total pixel budget; map to 1K (<1.25MP) or 2K (>=1.25MP) tiers.
  return width * height >= 1024 * 1024 * 1.25 ? 2_000_000 : 1_000_000;
}

function clampResolutionTier(pixels: number, options: string[]): string | undefined {
  const numeric = options
    .map((o) => ({ value: o, mp: o === "1K" ? 1 : o === "2K" ? 2 : o === "4K" ? 4 : NaN }))
    .filter((o) => Number.isFinite(o.mp))
    .sort((a, b) => a.mp - b.mp);
  if (numeric.length === 0) return undefined;
  const tierMp = pixels >= 1024 * 1024 * 1.25 ? 2 : 1;
  const chosen = numeric.find((o) => o.mp >= tierMp) ?? numeric[numeric.length - 1];
  return chosen.value;
}

type BuildContext = {
  width: number;
  height: number;
  aspectRatio: string;
  quality?: string;
  seed?: number;
  count?: number;
  negativePrompt?: string;
  prompt: string;
};

/**
 * Builds the request payload from the live catalog schema for a model. Only
 * parameters the catalog declares are included, and every value is clamped to a
 * value the provider accepts. Unsupported or out-of-range values are dropped —
 * never forwarded (this was the original rejection cause: "quality: high" sent
 * to a model that only accepts low|medium).
 */
function buildPayload(
  input: ImageGenerationRequest,
  model: ImageModelDefinition,
  remote: RemoteModel,
  prompt: string,
  width: number,
  height: number,
): { body: Record<string, unknown>; ctx: BuildContext } {
  const params = normalizeParams(remote.supported_parameters);
  const out: Record<string, unknown> = { model: model.id, prompt };
  const aspectRatioRaw = `${width}:${height}`;
  const gcd = greatestCommonDivisor(width, height);
  const ctx: BuildContext = {
    width,
    height,
    aspectRatio: `${width / gcd}:${height / gcd}`,
    prompt,
  };

  // Aspect ratio: snap to the nearest supported value.
  const arSchema = params.aspect_ratio;
  if (arSchema?.type === "enum") {
    const snapped = nearestAspectRatio(aspectRatioRaw, arSchema.values) ?? arSchema.values[0];
    ctx.aspectRatio = snapped;
    out.aspect_ratio = snapped;
  }

  // Resolution tier (1K/2K/4K). Many providers size purely by aspect ratio and
  // do not accept a resolution parameter at all.
  const resSchema = params.resolution;
  if (resSchema?.type === "enum") {
    const chosen = clampResolutionTier(resolutionTier(width, height), resSchema.values);
    if (chosen) out.resolution = chosen;
  }

  // Quality: map the user's fast|balanced|high to the model's accepted enum,
  // preferring the closest available tier and never sending an unsupported one.
  const qSchema = params.quality;
  if (qSchema?.type === "enum" && input.quality) {
    const wanted = QUALITY_TO_ENUM[input.quality];
    const available = qSchema.values.map((v) => v.toLowerCase());
    const exact = available.find((v) => v === wanted);
    const ranked = [...available]
      .filter((v) => v in QUALITY_RANK)
      .sort(
        (a, b) =>
          Math.abs(QUALITY_RANK[a as "low"] - QUALITY_RANK[wanted as "low"]) -
          Math.abs(QUALITY_RANK[b as "low"] - QUALITY_RANK[wanted as "low"]),
      );
    const resolved = exact ?? ranked[0];
    if (resolved) {
      ctx.quality = resolved;
      out.quality = resolved;
    }
  }

  // Count — only when the provider accepts n and we are requesting more than one.
  const nSchema = params.n;
  const maxN =
    nSchema?.type === "range"
      ? nSchema.max
      : nSchema?.type === "enum"
        ? Math.max(0, ...nSchema.values.map(Number).filter(Number.isFinite))
        : 0;
  if (input.count && input.count > 1 && maxN > 1) {
    out.n = Math.min(input.count, maxN);
    ctx.count = out.n as number;
  }

  // Seed — only when declared and provided.
  const seedSchema = params.seed;
  if (input.seed !== undefined && seedSchema) {
    if (seedSchema.type === "boolean") out.seed = input.seed;
    else if (seedSchema.type === "range")
      out.seed = Math.max(seedSchema.min, Math.min(seedSchema.max, input.seed));
  }

  // Editing: fold the source image + instruction into the prompt when the model
  // accepts input references; otherwise skip models that cannot edit.
  if (input.sourceImageUrl && params.input_references) {
    if (input.editInstruction) {
      out.prompt = `${prompt}\nEdit instruction: ${input.editInstruction}`;
      ctx.prompt = out.prompt as string;
    }
    out.input_references = [input.sourceImageUrl];
  } else if (input.sourceImageUrl) {
    out.prompt = prompt;
  }

  // Negative prompt: no OpenRouter model exposes a native parameter, so it is
  // folded into the prompt text instead of being dropped silently.
  if (input.negativePrompt?.trim()) {
    out.prompt = `${out.prompt}\nAvoid: ${input.negativePrompt.trim()}`;
    ctx.negativePrompt = input.negativePrompt.trim();
  }

  // Strip any accidental null/undefined that slipped in.
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return { body: out, ctx };
}

/** Parse a provider "parameter X not supported. Accepted: ..." rejection. */
function parseRejectedParams(detail: string): string[] {
  const text = (providerDetail(detail) ?? detail).toLowerCase();
  if (!text.includes("parameter")) return [];
  const names = new Set<string>();
  const tokens = text.match(/[a-z_]+/g) ?? [];
  const known = new Set([
    "model",
    "prompt",
    "n",
    "seed",
    "quality",
    "resolution",
    "aspect_ratio",
    "size",
    "input_references",
    "output_format",
    "background",
    "output_compression",
  ]);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t === "parameter") {
      if (known.has(next)) names.add(next);
      else names.add(next);
    }
    if ((t === "requested" || t === "supports") && known.has(next)) names.add(next);
    if (known.has(t)) names.add(t);
  }
  return [...names].filter((n) => n !== "model" && n !== "prompt");
}

/**
 * Repair a payload after the provider rejected some parameters. We strip the
 * offending fields and retry once, so a single mis-advertised capability never
 * kills the whole request. Learns per-model so the next request is clean.
 */
const learnedUnsupported = new Map<string, Set<string>>();
function repairPayload(
  body: Record<string, unknown>,
  modelId: string,
  detail: string,
): Record<string, unknown> | null {
  const learned = learnedUnsupported.get(modelId) ?? new Set<string>();
  const rejected = parseRejectedParams(detail);
  const remove = new Set<string>([...rejected, ...learned]);
  if (rejected.length === 0 && learned.size === 0) {
    // Could not identify the offending param; attempt a minimal body.
    return { model: modelId, prompt: body.prompt };
  }
  for (const key of remove) delete body[key];
  for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key];
  rejected.forEach((r) => learned.add(r));
  learnedUnsupported.set(modelId, learned);
  if (Object.keys(body).length <= 1) return null; // nothing left to send
  return body;
}

// ---------------------------------------------------------------------------
// Error classification & response parsing
// ---------------------------------------------------------------------------

function providerDetail(body: string): string | undefined {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    return typeof j.error === "string" ? j.error : (j.error?.message ?? j.message);
  } catch {
    return undefined;
  }
}

function parseRetryAfter(header: string | null, fallback: number): number {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds))
    return Math.min(IMAGE_CONFIG.providerTimeoutMs, Math.max(0, seconds * 1000));
  const date = Date.parse(header);
  if (Number.isFinite(date))
    return Math.min(IMAGE_CONFIG.providerTimeoutMs, Math.max(0, date - Date.now()));
  return fallback;
}

/** Map a provider HTTP status + body to a structured, user-safe error. */
function classify(status: number, body: string): ImageGatewayError {
  const detail = (providerDetail(body) ?? body).toLowerCase();
  const message = providerDetail(body);
  const hint = "Try another model or adjust your prompt.";

  if (status === 401)
    return new ImageGatewayError(
      "UNAUTHORIZED",
      "OpenRouter rejected the API key.",
      401,
      false,
      "401 Unauthorized",
      true,
      message,
      "Check OPENROUTER_API_KEY on the server.",
    );
  if (status === 403)
    return new ImageGatewayError(
      "FORBIDDEN",
      "OpenRouter denied this image request.",
      403,
      false,
      "403 Forbidden",
      true,
      message,
      hint,
    );
  if (status === 402 || detail.includes("quota") || detail.includes("credit"))
    return new ImageGatewayError(
      "QUOTA_EXCEEDED",
      "Image generation is paused: the OpenRouter account has no credits.",
      402,
      false,
      "Quota exceeded",
      true,
      message,
      "Add credits at openrouter.ai/settings/credits.",
    );
  if (status === 404)
    return new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The selected image model is unavailable.",
      404,
      false,
      "404 Model unavailable",
      false,
      message,
      hint,
    );
  if (status === 408)
    return new ImageGatewayError(
      "TIMEOUT",
      "The image provider timed out before responding.",
      408,
      true,
      "Request timeout",
      false,
      message,
      hint,
    );
  if (status === 409)
    return new ImageGatewayError(
      "IMAGE_GENERATION_FAILED",
      "The image request conflicted with the provider.",
      409,
      true,
      "Conflict",
      false,
      message,
      hint,
    );
  if (status === 429)
    return new ImageGatewayError(
      "PROVIDER_RATE_LIMITED",
      "The image provider is rate limited. Please try again shortly.",
      429,
      true,
      "429 Rate limited",
      false,
      message,
      hint,
    );
  if (detail.includes("safety") || detail.includes("policy") || detail.includes("moderation"))
    return new ImageGatewayError(
      "CONTENT_BLOCKED",
      "This prompt cannot be used to generate an image.",
      422,
      false,
      "Content blocked",
      true,
      message,
      "Rephrase the prompt and try again.",
    );
  if (status === 400 || status === 422) {
    if (
      detail.includes("parameter") ||
      detail.includes("not supported") ||
      detail.includes("invalid_value") ||
      detail.includes("zoderror")
    ) {
      return new ImageGatewayError(
        "MODEL_REJECTED_PARAMS",
        "The image request was rejected by the selected model.",
        status,
        false,
        "Invalid parameters",
        false,
        message,
        "Retrying with a compatible model.",
      );
    }
    return new ImageGatewayError(
      "INVALID_PROMPT",
      "The image request was rejected by the selected model.",
      status,
      false,
      "Invalid request body",
      false,
      message,
      hint,
    );
  }
  if (status >= 500)
    return new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The image provider is temporarily unavailable.",
      status,
      true,
      "Provider unavailable",
      false,
      message,
      hint,
    );
  return new ImageGatewayError(
    "IMAGE_GENERATION_FAILED",
    "Image generation failed. Please try again.",
    502,
    true,
    "Provider error",
    false,
    message,
    hint,
  );
}

function parseRetryAfterHeader(res: Response): number {
  return parseRetryAfter(res.headers.get("Retry-After"), 1000);
}

function imageFrom(payload: unknown): { url?: string; revisedPrompt?: string } {
  const root = payload as {
    data?: Array<{ url?: string; b64_json?: string; media_type?: string; revised_prompt?: string }>;
    images?: Array<{ url?: string }>;
    revised_prompt?: string;
  };
  const image = root.data?.[0];
  const url = image?.url
    ? image.url
    : image?.b64_json
      ? `data:${image.media_type ?? "image/png"};base64,${image.b64_json}`
      : root.images?.[0]?.url;
  return { url, revisedPrompt: image?.revised_prompt ?? root.revised_prompt };
}

// ---------------------------------------------------------------------------
// Startup validation & model registry verification
// ---------------------------------------------------------------------------

let startupValidated = false;
let startupPromise: Promise<ImageModelValidation> | null = null;

function toHealthStatus(code: ErrorCode, status: number): ImageHealthStatus {
  if (code === "UNAUTHORIZED") return "auth_failed";
  if (code === "QUOTA_EXCEEDED") return "quota";
  if (code === "CONTENT_BLOCKED") return "invalid";
  if (code === "MODEL_UNAVAILABLE") return "unsupported";
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "unavailable";
  return "invalid";
}

function capabilityReport(
  model: ImageModelDefinition,
  remote: RemoteModel | undefined,
): ImageModelCapabilityReport {
  const params = remote ? normalizeParams(remote.supported_parameters) : {};
  const outArch = remote?.architecture?.output_modalities ?? [];
  const arEnum = params.aspect_ratio?.type === "enum" ? params.aspect_ratio.values : undefined;
  const qEnum = params.quality?.type === "enum" ? params.quality.values : undefined;
  const resEnum = params.resolution?.type === "enum" ? params.resolution.values : undefined;
  const nSchema = params.n;
  const maxImagesPerRequest =
    nSchema?.type === "range"
      ? nSchema.max
      : nSchema?.type === "enum"
        ? Math.max(0, ...nSchema.values.map(Number).filter(Number.isFinite))
        : 1;
  const caps = model.capabilities;

  const issues: string[] = [];
  const exists = Boolean(remote);
  const available = exists && outArch.includes("image");
  if (!exists) issues.push("Model is not present in the OpenRouter image catalog.");
  else if (!available) issues.push("Catalog entry does not list image as an output modality.");
  if (available && caps.supportsQuality && !(params.quality?.type === "enum"))
    issues.push("Registry claims quality support but the catalog does not.");
  if (available && caps.supportsResolution && !(params.resolution?.type === "enum"))
    issues.push("Registry claims resolution support but the catalog does not.");
  if (available && caps.supportsSeed && params.seed === undefined)
    issues.push("Registry claims seed support but the catalog does not.");
  if (available && caps.supportsEditing && params.input_references === undefined)
    issues.push("Registry claims editing support but the catalog has no input_references.");
  if (available && caps.maxImagesPerRequest > maxImagesPerRequest)
    issues.push(
      `Registry maxImagesPerRequest (${caps.maxImagesPerRequest}) exceeds provider max (${maxImagesPerRequest}).`,
    );

  const status: ImageHealthStatus = !exists ? "unsupported" : available ? "healthy" : "invalid";
  return {
    id: model.id,
    label: model.label,
    exists,
    available,
    supportsGeneration: available,
    supportsAspectRatio: Boolean(arEnum),
    supportsQuality: params.quality?.type === "enum",
    supportsSeed: params.seed !== undefined,
    supportsResolution: params.resolution?.type === "enum",
    supportsNegativePrompt: false,
    supportsEditing: params.input_references !== undefined,
    supportsEnhancePrompt: true,
    maxImagesPerRequest,
    declaredMaxImages: caps.maxImages,
    issues,
    status,
    reason: issues[0] ?? (available ? "" : "Unknown"),
    resolutionTiers: resEnum,
    qualityLevels: qEnum,
    aspectRatios: arEnum,
  };
}

/** Verify every configured image model against the live catalog. */
export async function validateImageModels(): Promise<ImageModelValidation> {
  const issues: string[] = [];
  let catalog: Map<string, RemoteModel>;
  try {
    catalog = await discoverImageModels();
  } catch (error) {
    const safe =
      error instanceof ImageGatewayError
        ? error
        : new ImageGatewayError(
            "MODEL_UNAVAILABLE",
            "Unable to validate image configuration.",
            502,
            true,
            "Provider unavailable",
          );
    const models = IMAGE_MODELS.map((m) => ({
      ...capabilityReport(m, undefined),
      status: toHealthStatus(safe.code, safe.status) as ImageHealthStatus,
      reason: safe.message,
    }));
    for (const m of models) issues.push(`${m.label}: ${safe.message}`);
    return { valid: false, issues, models };
  }

  const models = IMAGE_MODELS.map((m) => capabilityReport(m, catalog.get(m.id)));
  for (const rep of models) {
    if (rep.issues.length) {
      for (const issue of rep.issues) issues.push(`${rep.label}: ${issue}`);
      rep.message = rep.issues[0];
    }
  }
  return { valid: issues.length === 0, issues, models };
}

/** Catalog-only startup validation: does not create billable images. */
export async function validateImageModelsAtStartup(): Promise<ImageModelValidation> {
  const infra = getGatewayInfrastructure(createLogger(GATEWAY_CONFIG));
  console.info("IMAGE MODELS");
  if (!validateApiKey(process.env.OPENROUTER_API_KEY).valid) {
    for (const m of IMAGE_MODELS) {
      infra.healthCache.set({
        provider: m.provider,
        model: m.id,
        status: "missing_api_key",
        reason: "Missing OPENROUTER_API_KEY",
        timestamp: Date.now(),
        expiresAt: Date.now() + ttlForStatus(401),
        httpStatus: 401,
        retryable: false,
      });
      console.info(`  ✗ ${m.label}\n    Reason: Missing OPENROUTER_API_KEY`);
    }
    return {
      valid: false,
      issues: ["Missing OPENROUTER_API_KEY"],
      models: IMAGE_MODELS.map((m) => ({
        ...capabilityReport(m, undefined),
        status: "missing_api_key",
      })),
    };
  }
  const report = await validateImageModels();
  for (const rep of report.models) {
    const healthy = rep.status === "healthy";
    infra.healthCache.set({
      provider: IMAGE_MODELS.find((m) => m.id === rep.id)!.provider,
      model: rep.id,
      status: rep.status,
      reason: rep.reason,
      timestamp: Date.now(),
      expiresAt: Date.now() + (healthy ? IMAGE_CONFIG.healthTtlDefaultMs : ttlForStatus(404)),
      httpStatus: healthy ? undefined : 404,
      retryable: false,
    });
    console.info(
      `  ${healthy ? "✓" : "✗"} ${rep.label}${healthy ? "" : `\n    Reason: ${rep.reason}`}`,
    );
    if (rep.issues.length) for (const issue of rep.issues) console.info(`    ! ${issue}`);
  }
  return report;
}

function ensureStartup(): Promise<ImageModelValidation> | null {
  if (startupValidated) return null;
  if (process.env.VITEST) return null;
  if (!startupPromise) {
    startupPromise = validateImageModelsAtStartup().then((r) => {
      startupValidated = true;
      return r;
    });
  }
  return startupPromise;
}

// ---------------------------------------------------------------------------
// Generation with automatic fallback, repair, backoff, and recovery
// ---------------------------------------------------------------------------

const log = (
  infra: ReturnType<typeof getGatewayInfrastructure>,
  event: string,
  payload: Record<string, unknown>,
) => infra.logger.info(event, payload);

function ttlForStatus(status: number): number {
  const map = IMAGE_CONFIG.healthTtlByStatus as Record<number, number>;
  return map[status] ?? IMAGE_CONFIG.healthTtlDefaultMs;
}

export async function generateImageWithFallback(
  input: ImageGenerationRequest,
  requestId = crypto.randomUUID(),
): Promise<ImageGenerationResult> {
  const infra = getGatewayInfrastructure(createLogger(GATEWAY_CONFIG));
  const logger = infra.logger;
  const requested = getImageModel(input.model);

  if (input.model && !requested) {
    throw new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      "The selected image model is not registered.",
      400,
      false,
      "Invalid model",
      false,
      undefined,
      hintForModel(input.model),
    );
  }
  if (!validateApiKey(process.env.OPENROUTER_API_KEY).valid) {
    throw new ImageGatewayError(
      "MISSING_API_KEY",
      "Missing OPENROUTER_API_KEY. Configure it on the server and in Vercel.",
      503,
      false,
      "Missing OPENROUTER_API_KEY",
      true,
      undefined,
      "Set OPENROUTER_API_KEY and restart the server.",
    );
  }

  log(infra, "image_request_started", {
    requestId,
    requestedModel: requested?.id ?? DEFAULT_IMAGE_MODEL_ID,
    promptLength: input.prompt.length,
    width: input.width,
    height: input.height,
    quality: input.quality,
    count: input.count ?? 1,
    aspectRatio: input.width && input.height ? `${input.width}:${input.height}` : undefined,
    hasNegativePrompt: Boolean(input.negativePrompt),
    hasSourceImage: Boolean(input.sourceImageUrl),
    seed: input.seed,
    steps: input.steps,
  });

  await ensureStartup();
  const catalog = await discoverImageModels();
  const candidates = requested
    ? [requested, ...IMAGE_MODELS.filter((m) => m.id !== requested.id)]
    : [...IMAGE_MODELS];
  const seen = new Set<string>();
  const uniqueCandidates = candidates.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  const enhanced = enhanceImagePrompt(input.prompt, input.enhancePrompt !== false, input.profile);
  const attempts: ImageAttempt[] = [];
  const startTime = performance.now();
  let last: ImageGatewayError | null = null;
  let fallbackCount = 0;
  let totalAttempts = 0;
  // Terminal, account/prompt-level failures (auth, quota, content policy) apply
  // to every model behind the same key/catalog, so retrying other models is
  // futile and wastes billable calls. Set once and break the whole chain.
  let stopFallthrough = false;

  for (const model of uniqueCandidates) {
    const remote = catalog.get(model.id);
    const health = infra.healthCache.get(model.provider, model.id);
    if (
      !remote ||
      !remote.architecture?.output_modalities?.includes("image") ||
      (health && health.status !== "healthy") ||
      infra.circuitBreaker.isOpen(model.provider, model.id)
    ) {
      if (model.id !== (requested?.id ?? DEFAULT_IMAGE_MODEL_ID)) fallbackCount++;
      log(infra, "image_provider_skipped", {
        requestId,
        model: model.id,
        reason: health?.reason ?? "Model unavailable",
        status: health?.status,
      });
      attempts.push({
        model: model.id,
        provider: "OpenRouter",
        status: health?.httpStatus ?? 0,
        reason: health?.reason ?? "Model unavailable (skipped before request)",
        retryable: true,
        fatal: false,
      });
      continue;
    }
    if (input.sourceImageUrl && !normalizeParams(remote.supported_parameters).input_references) {
      log(infra, "image_provider_skipped", {
        requestId,
        model: model.id,
        reason: "Editing not supported",
      });
      continue;
    }

    const width = dim(input.width, model.maxWidth);
    const height = dim(input.height, model.maxHeight);
    let { body } = buildPayload(input, model, remote, enhanced.prompt, width, height);
    let repairedForThisModel = 0;
    let triedThisModel = false;

    for (let attempt = 0; attempt < IMAGE_CONFIG.maxAttemptsPerModel; attempt++) {
      if (performance.now() - startTime > IMAGE_CONFIG.requestDeadlineMs) break;
      if (totalAttempts >= IMAGE_CONFIG.maxTotalAttempts) break;
      totalAttempts++;
      triedThisModel = true;
      const started = performance.now();
      try {
        log(infra, "image_provider_request", {
          requestId,
          endpoint: "/api/v1/images",
          provider: "OpenRouter",
          model: model.id,
          attempt,
          repaired: repairedForThisModel > 0,
          auth: "Bearer [configured]",
          payload: redactPayload(body),
        });
        const response = await fetch(IMAGES_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_REFERER || "https://lordai.app",
            "X-Title": process.env.OPENROUTER_TITLE || "LordAI",
          },
          signal: AbortSignal.timeout(IMAGE_CONFIG.providerTimeoutMs),
          body: JSON.stringify(body),
        });
        const raw = await response.text();
        const imageReceived = response.ok && Boolean(imageFrom(JSON.parse(raw) || {}).url);
        log(infra, "image_provider_response", {
          requestId,
          model: model.id,
          status: response.status,
          ok: response.ok,
          latencyMs: Math.round(performance.now() - started),
          imageReceived,
        });
        if (!response.ok) throw classify(response.status, raw);

        const image = imageFrom(JSON.parse(raw));
        if (!image.url) {
          const err = new ImageGatewayError(
            "IMAGE_GENERATION_FAILED",
            "The provider returned no image.",
            502,
            true,
            "No image returned",
            false,
          );
          attempts.push({
            model: model.id,
            provider: "OpenRouter",
            status: 502,
            reason: err.reason,
            retryable: true,
            fatal: false,
            requestId,
          });
          throw err;
        }

        const generationTime = Math.round(performance.now() - started);
        infra.healthCache.set({
          provider: model.provider,
          model: model.id,
          status: "healthy",
          reason: "",
          timestamp: Date.now(),
          expiresAt: Date.now() + IMAGE_CONFIG.healthTtlDefaultMs,
        });
        infra.circuitBreaker.recordSuccess(model.provider, model.id);
        log(infra, "image_generation_complete", {
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
          enhancedPrompt: image.revisedPrompt ?? (body.prompt as string),
          queueTime: 0,
          retryCount: attempt,
          fallbackCount,
          estimatedCost: model.estimatedPrice,
        };
      } catch (error) {
        const err =
          error instanceof ImageGatewayError
            ? error
            : error instanceof DOMException && error.name === "TimeoutError"
              ? new ImageGatewayError(
                  "TIMEOUT",
                  "The image provider timed out.",
                  408,
                  true,
                  "Network timeout",
                  false,
                )
              : new ImageGatewayError(
                  "IMAGE_GENERATION_FAILED",
                  "Image generation failed. Please try again.",
                  502,
                  true,
                  "Network error",
                  false,
                );

        attempts.push({
          model: model.id,
          provider: "OpenRouter",
          status: err.status,
          reason: err.reason,
          retryable: err.retryable,
          fatal: err.fatal,
          providerMessage: err.providerMessage,
          errorCode: err.code,
          requestId,
        });
        log(infra, "image_provider_error", {
          requestId,
          model: model.id,
          status: err.status,
          code: err.code,
          reason: err.reason,
          fatal: err.fatal,
          retryable: err.retryable,
        });

        // Fatal, account/prompt-level errors: never retry, never fall back.
        if (err.fatal) {
          infra.healthCache.set({
            provider: model.provider,
            model: model.id,
            status: toHealthStatus(err.code, err.status),
            reason: err.reason,
            timestamp: Date.now(),
            expiresAt: Date.now() + ttlForStatus(err.status),
            httpStatus: err.status,
            retryable: err.retryable,
          });
          last = err;
          stopFallthrough = true;
          break;
        }

        // 429: exponential backoff then retry the same model once before fallback.
        if (err.status === 429) {
          const retryAfter = parseRetryAfter(null, 1000);
          log(infra, "image_provider_backoff", {
            requestId,
            model: model.id,
            retryAfterMs: retryAfter,
            reason: "rate_limited",
          });
          await sleep(retryAfter);
          continue;
        }

        // 422/400 rejected params: repair once and retry the same model.
        if (
          err.code === "MODEL_REJECTED_PARAMS" &&
          repairedForThisModel < IMAGE_CONFIG.maxPayloadRepairs
        ) {
          const fixed = repairPayload({ ...body }, model.id, err.providerMessage ?? "");
          if (fixed) {
            body = fixed;
            repairedForThisModel++;
            log(infra, "image_payload_repaired", {
              requestId,
              model: model.id,
              repairedParams: repairedForThisModel,
            });
            continue;
          }
        }

        // 5xx / timeout / generic: short backoff, retry once, then fall back.
        if (err.retryable && attempt === 0) {
          await sleep(jitter(1000));
          continue;
        }

        // Exhausted for this model — record health, open circuit if repeated, fall back.
        infra.circuitBreaker.recordFailure(model.provider, model.id);
        infra.healthCache.set({
          provider: model.provider,
          model: model.id,
          status: toHealthStatus(err.code, err.status),
          reason: err.reason,
          timestamp: Date.now(),
          expiresAt: Date.now() + ttlForStatus(err.status),
          httpStatus: err.status,
          retryable: err.retryable,
        });
        last = err;
        break;
      }
    }
    // A terminal account/prompt error means every remaining model would fail
    // identically — stop here instead of burning more billable calls.
    if (stopFallthrough) break;
    if (triedThisModel) fallbackCount++;
  }

  // All candidates exhausted. If nothing was even attempted, surface the cached
  // reason (e.g. all disabled by quota) instead of a generic message.
  if (attempts.length && !attempts.some((a) => a.status > 0)) {
    const cached = attempts[0];
    throw new ImageGatewayError(
      "MODEL_UNAVAILABLE",
      cached.reason || "No compatible image model is currently available.",
      503,
      true,
      cached.reason || "No healthy model",
      false,
      cached.providerMessage,
    );
  }
  throw (
    last ??
    new ImageGatewayError(
      "IMAGE_GENERATION_FAILED",
      "Image generation failed. Please try again.",
      502,
      true,
      "Provider error",
      false,
      undefined,
      "Try again shortly.",
    )
  );
}

// ---------------------------------------------------------------------------
// Helpers exposed for UI / diagnostics
// ---------------------------------------------------------------------------

function redactPayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  if (typeof out.prompt === "string") out.prompt = `[redacted length=${out.prompt.length}]`;
  return out;
}

function hintForModel(modelId: string): string {
  const alt = IMAGE_MODELS.find((m) => m.id !== modelId);
  return alt ? `Try ${alt.label} instead.` : "Select another model.";
}

export type ImageCredentialStatus = {
  provider: string;
  /** True when the credential is present and well-formed. */
  configured: boolean;
  /** Clean, user-safe status: ok | missing | invalid | unverified. */
  status: "ok" | "missing" | "invalid" | "unverified";
  message: string;
  /** Never contains the raw key — only a length/format summary. */
  detail?: string;
};

/**
 * Validates every credential the image pipeline can use, returning clean,
 * user-safe diagnostics instead of generic errors. OpenRouter is the primary
 * server-side image provider; Cloudflare is routed through it; OpenAI/Gemini
 * keys are reported for operator visibility even though images are generated
 * via OpenRouter today.
 */
export function getImageCredentialDiagnostics(): ImageCredentialStatus[] {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
  const cloudflareAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const summarize = (key?: string) =>
    key && key.length > 0 ? `present (${key.length} chars)` : undefined;

  const statuses: ImageCredentialStatus[] = [];

  const orValidation = validateApiKey(openrouterKey);
  statuses.push({
    provider: "openrouter",
    configured: orValidation.valid,
    status: !openrouterKey ? "missing" : orValidation.valid ? "ok" : "invalid",
    message: !openrouterKey
      ? "OPENROUTER_API_KEY is not set. Image generation cannot run on the server."
      : orValidation.valid
        ? "OpenRouter API key is present."
        : `OpenRouter API key looks invalid: ${orValidation.issue ?? "unknown"}`,
    detail: summarize(openrouterKey),
  });

  const cfOk = Boolean(cloudflareToken && cloudflareAccount);
  statuses.push({
    provider: "cloudflare",
    configured: cfOk,
    status: cfOk ? "ok" : "missing",
    message: cfOk
      ? "Cloudflare credentials are present (used for direct Workers AI image generation)."
      : "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is missing. Cloudflare image generation is unavailable.",
    detail: cloudflareToken ? summarize(cloudflareToken) : undefined,
  });

  const oaValidation = validateApiKey(openaiKey);
  statuses.push({
    provider: "openai",
    configured: oaValidation.valid,
    status: !openaiKey ? "missing" : oaValidation.valid ? "ok" : "invalid",
    message: !openaiKey
      ? "OPENAI_API_KEY is not set (not used for images today)."
      : oaValidation.valid
        ? "OpenAI API key is present."
        : `OpenAI API key looks invalid: ${oaValidation.issue ?? "unknown"}`,
    detail: summarize(openaiKey),
  });

  const gemValidation = validateApiKey(geminiKey);
  statuses.push({
    provider: "gemini",
    configured: gemValidation.valid,
    status: !geminiKey ? "missing" : gemValidation.valid ? "ok" : "invalid",
    message: !geminiKey
      ? "GEMINI_API_KEY is not set (not used for images today)."
      : gemValidation.valid
        ? "Gemini API key is present."
        : `Gemini API key looks invalid: ${gemValidation.issue ?? "unknown"}`,
    detail: summarize(geminiKey),
  });

  return statuses;
}

/** Snapshot of image-model health for the admin/observability endpoints. */
export async function getImageModelHealth(): Promise<ImageModelCapabilityReport[]> {
  let catalog: Map<string, RemoteModel>;
  try {
    catalog = await discoverImageModels();
  } catch {
    catalog = new Map();
  }
  return IMAGE_MODELS.map((m) => {
    const report = capabilityReport(m, catalog.get(m.id));
    const health = getGatewayInfrastructure(createLogger(GATEWAY_CONFIG)).healthCache.get(
      m.provider,
      m.id,
    );
    if (health && health.status !== "healthy") {
      report.status = health.status as ImageHealthStatus;
      report.reason = health.reason || report.reason;
      if (health.reason) report.message = health.reason;
    }
    return report;
  });
}
