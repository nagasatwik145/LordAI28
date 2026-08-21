// Cloudflare Workers AI image model registry — the single source of truth.
//
// Every model id in the application comes from this file. Nothing else may
// hard-code a model id, and provider selection is never inferred from the shape
// of a model name: an id is either registered here or it is rejected.
//
// ADDING A MODEL
// --------------
// Add one entry to {@link IMAGE_MODEL_REGISTRY}. `priority` decides its place in
// the automatic fallback chain; everything else (UI list, capabilities, request
// encoding, parameter clamping, health checks, tests) is derived from the entry.
//
// WHY EACH ENTRY DECLARES A REQUEST CONTRACT
// ------------------------------------------
// Workers AI does not expose one uniform image API — each model publishes its own
// JSON Schema behind the same `/ai/run/{model}` endpoint, and the differences are
// hard failures rather than ignored fields:
//
//   * The FLUX.2 family (`flux-2-*`) is a partner passthrough whose schema is
//     literally `{ required: ["multipart"] }`. Sending JSON returns HTTP 400:
//       "AiError: Bad input: Error: required properties at '/' are 'multipart'".
//   * `flux-1-schnell` accepts ONLY `prompt` + `steps`. Sending `width`/`height`
//     returns HTTP 400:
//       "Additional or unevaluated properties '/width, /height' at '/' not allowed".
//   * Numeric values outside a schema's `minimum`/`maximum` are a 400, so every
//     value is clamped into the declared bounds instead of being forwarded.
//
// The contracts below were captured from the live
// `GET /accounts/{id}/ai/models/schema?model=…` endpoint. The provider refreshes
// them from that endpoint at runtime (cached) and falls back to these verified
// values whenever the metadata call cannot run, so generation never fails just
// because a metadata request did.

import type { ImageInputMode, ImageQuality } from "./image-types";
import type { ImageProviderId } from "./image-types";

/** Inclusive numeric bounds for one parameter, as declared by the schema. */
export interface ParamBounds {
  min?: number;
  max?: number;
}

/** How a model's diffusion-step parameter is named and driven by quality. */
export interface ImageModelStepsConfig {
  param: "steps" | "num_steps";
  byQuality: Readonly<Record<ImageQuality, number>>;
}

/** How a model's guidance parameter is driven by quality. */
export interface ImageModelGuidanceConfig {
  byQuality: Readonly<Record<ImageQuality, number>>;
}

export interface ImageModelRegistryEntry {
  /** Workers AI model id, e.g. `@cf/black-forest-labs/flux-2-klein-9b`. */
  id: string;
  /** Explicit for current entries; legacy Cloudflare entries omit it. */
  provider?: ImageProviderId;
  label: string;
  description: string;
  badges: readonly string[];
  /** Fallback order (ascending). The lowest priority is the default model. */
  priority: number;
  /** Request encoding this model requires. */
  inputMode: ImageInputMode;
  /** Parameters the model declares. Anything else must be dropped. */
  params: readonly string[];
  /** Numeric bounds per parameter; values are clamped, never forwarded raw. */
  bounds: Readonly<Record<string, ParamBounds>>;
  /** Size the model produces when it does not accept width/height. */
  nativeSize: { width: number; height: number };
  steps?: ImageModelStepsConfig;
  guidance?: ImageModelGuidanceConfig;
  /** Images LORD will request for one user request (one call per image). */
  maxImages: number;
  /**
   * Workers AI bills in neurons rather than per image, so there is no reliable
   * per-image price. Kept at 0 instead of inventing a number; the gallery stores
   * it for schema compatibility only.
   */
  estimatedCost: number;
  /** Content type the schema claims. Advisory only — bytes are always sniffed. */
  declaredOutput?: string;
}

/** Parameters the FLUX.2 multipart passthrough accepts. */
const MULTIPART_PARAMS = [
  "prompt",
  "width",
  "height",
  "seed",
  "aspect_ratio",
  "output_format",
  "prompt_upsampling",
  "steps",
  "guidance",
] as const;

const MULTIPART_BOUNDS: Record<string, ParamBounds> = {
  width: { min: 256, max: 2048 },
  height: { min: 256, max: 2048 },
  seed: { min: 0 },
};

/** Parameters shared by the Stable-Diffusion-family schemas. */
const SD_PARAMS = [
  "prompt",
  "negative_prompt",
  "height",
  "width",
  "image",
  "image_b64",
  "mask",
  "num_steps",
  "strength",
  "guidance",
  "seed",
] as const;

const SD_BOUNDS: Record<string, ParamBounds> = {
  width: { min: 256, max: 2048 },
  height: { min: 256, max: 2048 },
  num_steps: { min: 1, max: 20 },
  guidance: { min: 0, max: 20 },
  seed: { min: 0 },
};

const SD_STEPS: ImageModelStepsConfig = {
  param: "num_steps",
  byQuality: { fast: 6, balanced: 12, high: 20 },
};

const SD_GUIDANCE: ImageModelGuidanceConfig = {
  byQuality: { fast: 6, balanced: 7.5, high: 9 },
};

/**
 * The registry. Order here is documentation only — {@link IMAGE_MODEL_REGISTRY}
 * is sorted by `priority`, which is also the automatic fallback chain:
 *
 *   FLUX 2 Klein → FLUX Schnell → FLUX 2 Dev → SDXL Lightning → …
 */
const REGISTRY_ENTRIES: readonly ImageModelRegistryEntry[] = [
  {
    id: "@cf/black-forest-labs/flux-1-schnell",
    provider: "cloudflare",
    label: "FLUX Schnell",
    description: "Fast Cloudflare image generation.",
    badges: ["Cloudflare", "Fast"],
    priority: 1,
    inputMode: "json",
    params: ["prompt", "steps"],
    bounds: { steps: { min: 1, max: 8 } },
    nativeSize: { width: 1024, height: 1024 },
    steps: { param: "steps", byQuality: { fast: 4, balanced: 6, high: 8 } },
    maxImages: 4,
    estimatedCost: 0,
  },
  {
    id: "@cf/black-forest-labs/flux-1-dev",
    provider: "cloudflare",
    label: "FLUX Dev",
    description: "High-quality Cloudflare image generation.",
    badges: ["Cloudflare"],
    priority: 2,
    inputMode: "json",
    params: ["prompt"],
    bounds: {},
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
  },
  {
    id: "@cf/black-forest-labs/flux-1-kontext-dev",
    provider: "cloudflare",
    label: "FLUX Kontext Dev",
    description: "Cloudflare context-aware image generation.",
    badges: ["Cloudflare", "Edit"],
    priority: 3,
    inputMode: "json",
    params: ["prompt"],
    bounds: {},
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
  },
  {
    id: "@cf/black-forest-labs/flux-1-kontext-max",
    provider: "cloudflare",
    label: "FLUX Kontext Max",
    description: "Highest-quality Cloudflare context image generation.",
    badges: ["Cloudflare", "Premium"],
    priority: 4,
    inputMode: "json",
    params: ["prompt"],
    bounds: {},
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
  },
  {
    id: "x-ai/grok-imagine-image-2.0",
    provider: "openrouter",
    label: "Grok Imagine Image",
    description: "OpenRouter image generation by xAI.",
    badges: ["OpenRouter"],
    priority: 101,
    inputMode: "json",
    params: ["prompt", "aspect_ratio", "quality", "resolution"],
    bounds: {},
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 1,
    estimatedCost: 0,
  },
  {
    id: "black-forest-labs/flux.2-max",
    provider: "openrouter",
    label: "FLUX 2 Max",
    description: "OpenRouter FLUX image generation.",
    badges: ["OpenRouter"],
    priority: 102,
    inputMode: "json",
    params: ["prompt", "aspect_ratio", "seed"],
    bounds: { seed: { min: 0 } },
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 1,
    estimatedCost: 0,
  },
  {
    id: "google/gemini-3.1-flash-lite-image",
    provider: "openrouter",
    label: "Gemini Flash Lite Image",
    description: "OpenRouter Gemini image generation.",
    badges: ["OpenRouter"],
    priority: 103,
    inputMode: "json",
    params: ["prompt", "resolution"],
    bounds: {},
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 1,
    estimatedCost: 0,
  },
  {
    id: "qwen/qwen-image-3-pro",
    provider: "openrouter",
    label: "Qwen Image 3 Pro",
    description: "OpenRouter Qwen image generation.",
    badges: ["OpenRouter"],
    priority: 104,
    inputMode: "json",
    params: ["prompt", "resolution", "seed"],
    bounds: { seed: { min: 0 } },
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 1,
    estimatedCost: 0,
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-9b",
    label: "FLUX 2 Klein",
    description: "Black Forest Labs FLUX.2 Klein 9B — best overall quality and prompt adherence.",
    badges: ["Recommended", "High Quality"],
    priority: 1,
    inputMode: "multipart",
    params: MULTIPART_PARAMS,
    bounds: MULTIPART_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "application/json",
  },
  {
    id: "@cf/black-forest-labs/flux-1-schnell",
    label: "FLUX Schnell",
    description: "FLUX.1 schnell — fastest generation, ideal for drafts and iteration.",
    badges: ["Fast"],
    priority: 2,
    inputMode: "json",
    // Strict schema: prompt + steps only. Anything else is a hard 400.
    params: ["prompt", "steps"],
    bounds: { steps: { min: 1, max: 8 } },
    nativeSize: { width: 1024, height: 1024 },
    steps: { param: "steps", byQuality: { fast: 4, balanced: 6, high: 8 } },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "application/json",
  },
  {
    id: "@cf/black-forest-labs/flux-2-dev",
    label: "FLUX 2 Dev",
    description: "FLUX.2 dev — detailed, photorealistic renders at higher latency.",
    badges: ["Photorealistic"],
    priority: 3,
    inputMode: "multipart",
    params: MULTIPART_PARAMS,
    bounds: MULTIPART_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "application/json",
  },
  {
    id: "@cf/bytedance/stable-diffusion-xl-lightning",
    label: "SDXL Lightning",
    description: "ByteDance SDXL Lightning — fast SDXL with negative prompt and seed control.",
    badges: ["Fast", "Negative Prompt"],
    priority: 4,
    inputMode: "json",
    params: SD_PARAMS,
    bounds: SD_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    steps: SD_STEPS,
    guidance: SD_GUIDANCE,
    maxImages: 4,
    estimatedCost: 0,
    // Declares PNG but returns JPEG bytes — the parser sniffs the real format.
    declaredOutput: "image/png",
  },
  {
    id: "@cf/black-forest-labs/flux-2-klein-4b",
    label: "FLUX 2 Klein 4B",
    description: "Smaller FLUX.2 Klein — lower latency than the 9B variant.",
    badges: ["Fast"],
    priority: 5,
    inputMode: "multipart",
    params: MULTIPART_PARAMS,
    bounds: MULTIPART_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "application/json",
  },
  {
    id: "@cf/leonardo/lucid-origin",
    label: "Lucid Origin",
    description: "Leonardo Lucid Origin — crisp graphic design, text, and illustration.",
    badges: ["Illustration"],
    priority: 6,
    inputMode: "json",
    params: ["prompt", "guidance", "seed", "height", "width", "num_steps", "steps"],
    bounds: {
      width: { min: 256, max: 2500 },
      height: { min: 256, max: 2500 },
      num_steps: { min: 1, max: 40 },
      steps: { min: 1, max: 40 },
      guidance: { min: 0, max: 10 },
      seed: { min: 0 },
    },
    nativeSize: { width: 1120, height: 1120 },
    steps: { param: "num_steps", byQuality: { fast: 10, balanced: 20, high: 40 } },
    guidance: { byQuality: { fast: 3, balanced: 4.5, high: 7 } },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "application/json",
  },
  {
    id: "@cf/leonardo/phoenix-1.0",
    label: "Leonardo Phoenix",
    description: "Leonardo Phoenix 1.0 — stylised imagery with negative prompt support.",
    badges: ["Illustration", "Negative Prompt"],
    priority: 7,
    inputMode: "json",
    params: ["prompt", "guidance", "seed", "height", "width", "num_steps", "negative_prompt"],
    bounds: {
      width: { min: 256, max: 2048 },
      height: { min: 256, max: 2048 },
      num_steps: { min: 1, max: 50 },
      guidance: { min: 2, max: 10 },
      seed: { min: 0 },
    },
    nativeSize: { width: 1024, height: 1024 },
    steps: { param: "num_steps", byQuality: { fast: 12, balanced: 25, high: 50 } },
    guidance: { byQuality: { fast: 2, balanced: 4, high: 7 } },
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "image/jpeg",
  },
  {
    id: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    label: "SDXL Base",
    description: "Stability AI SDXL 1.0 — dependable general-purpose diffusion baseline.",
    badges: ["Balanced", "Negative Prompt"],
    priority: 8,
    inputMode: "json",
    params: SD_PARAMS,
    bounds: SD_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    steps: SD_STEPS,
    guidance: SD_GUIDANCE,
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "image/png",
  },
  {
    id: "@cf/lykon/dreamshaper-8-lcm",
    label: "DreamShaper 8 LCM",
    description: "Lykon DreamShaper 8 LCM — stylised art at very low step counts.",
    badges: ["Fast", "Stylised"],
    priority: 9,
    inputMode: "json",
    params: SD_PARAMS,
    bounds: SD_BOUNDS,
    nativeSize: { width: 1024, height: 1024 },
    steps: SD_STEPS,
    guidance: SD_GUIDANCE,
    maxImages: 4,
    estimatedCost: 0,
    declaredOutput: "image/png",
  },
];

/** Every registered model, in fallback order. */
export const IMAGE_MODEL_REGISTRY: readonly ImageModelRegistryEntry[] = Object.freeze(
  // Entries without an explicit provider are retired legacy definitions. Keeping
  // them above temporarily preserves git history while ensuring they cannot be
  // routed, displayed, or accepted by the API.
  [...REGISTRY_ENTRIES]
    .filter((entry) => entry.provider !== undefined)
    .sort((a, b) => a.priority - b.priority),
);

/** Cached metadata lookups so hot paths never rescan the registry. */
const BY_ID = new Map(IMAGE_MODEL_REGISTRY.map((entry) => [entry.id, entry]));
const PARAM_SETS = new Map(
  IMAGE_MODEL_REGISTRY.map((entry) => [entry.id, new Set<string>(entry.params)]),
);

/** Registered model ids, in fallback order. */
export const IMAGE_MODEL_IDS: readonly string[] = Object.freeze(
  IMAGE_MODEL_REGISTRY.map((entry) => entry.id),
);

/** The default model: first in the fallback chain. */
export const DEFAULT_IMAGE_MODEL_ID = IMAGE_MODEL_REGISTRY[0].id;

/** Look up a registry entry. Returns `undefined` for unregistered ids. */
export function getImageModel(id?: string | null): ImageModelRegistryEntry | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/** True when `id` is a registered Cloudflare image model. */
export function isRegisteredImageModel(id?: string | null): boolean {
  return Boolean(id && BY_ID.has(id));
}

/** Human label for a model id (falls back to the raw id for legacy rows). */
export function getImageModelLabel(id?: string | null): string {
  if (!id) return "Unknown model";
  return BY_ID.get(id)?.label ?? id;
}

/** Provider ownership comes from the registry; legacy entries are Cloudflare. */
export function getImageModelProvider(id: string): ImageProviderId | undefined {
  const entry = BY_ID.get(id);
  return entry ? (entry.provider ?? "cloudflare") : undefined;
}

/** The parameter allow-list for a model, as a cached `Set`. */
export function getImageModelParams(id: string): ReadonlySet<string> {
  return PARAM_SETS.get(id) ?? new Set<string>(["prompt"]);
}

/** Clamp a numeric value into the bounds a model declares. */
export function clampToBounds(value: number, bounds: ParamBounds | undefined): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  let next = value;
  if (bounds?.min !== undefined) next = Math.max(next, bounds.min);
  if (bounds?.max !== undefined) next = Math.min(next, bounds.max);
  return next;
}

export interface ResolvedConfiguredModel {
  id: string;
  /** Set when the configured value was ignored, for startup logging. */
  warning?: string;
}

/**
 * Resolve the `CLOUDFLARE_IMAGE_MODEL` environment value against the registry.
 *
 * An unregistered id is ignored (with a warning) rather than used, because the
 * request contract for an unknown model is not known and would produce an
 * avoidable HTTP 400 on the user's first generation.
 */
export function resolveConfiguredModelId(raw?: string | null): ResolvedConfiguredModel {
  const trimmed = raw?.trim();
  if (!trimmed) return { id: DEFAULT_IMAGE_MODEL_ID };
  if (BY_ID.has(trimmed)) return { id: trimmed };
  return {
    id: DEFAULT_IMAGE_MODEL_ID,
    warning: `CLOUDFLARE_IMAGE_MODEL="${trimmed}" is not a registered model. Using ${DEFAULT_IMAGE_MODEL_ID}. Registered ids: ${IMAGE_MODEL_IDS.join(", ")}.`,
  };
}

export interface FallbackChainOptions {
  /** Preferred model, tried first when it is registered and selectable. */
  requested?: string | null;
  /** Model that acts as the head of the chain when nothing was requested. */
  preferred?: string | null;
  /** Optional filter, e.g. "model is healthy right now". */
  isSelectable?: (entry: ImageModelRegistryEntry) => boolean;
}

/**
 * Build the ordered Cloudflare-only fallback chain for one request.
 *
 * The chain is always: requested model → configured default → registry priority
 * order, de-duplicated. It can never contain a non-Cloudflare provider because
 * the registry only holds Cloudflare models.
 */
export function buildFallbackChain(options: FallbackChainOptions = {}): ImageModelRegistryEntry[] {
  const { requested, preferred, isSelectable } = options;
  const ordered: ImageModelRegistryEntry[] = [];
  const push = (entry?: ImageModelRegistryEntry) => {
    if (!entry) return;
    if (ordered.some((existing) => existing.id === entry.id)) return;
    ordered.push(entry);
  };

  push(getImageModel(requested));
  push(getImageModel(preferred));
  for (const entry of IMAGE_MODEL_REGISTRY) push(entry);

  if (!isSelectable) return ordered;
  const selectable = ordered.filter(isSelectable);
  // Never return an empty chain: if health data disqualified everything, still
  // attempt the requested/default model so the user gets a real provider error
  // instead of a silent "nothing to try".
  return selectable.length > 0 ? selectable : ordered.slice(0, 1);
}
