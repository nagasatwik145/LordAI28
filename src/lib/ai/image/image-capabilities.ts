// Capability resolution for Cloudflare image models.
//
// Capabilities are DERIVED from the registry contract (the parameters a model
// declares), never hand-maintained in a second place and never inferred from a
// model name. Results are cached because they are pure functions of static
// registry data and are read on every request and every UI render.
//
// This module is also where a user-level request is translated into
// model-legal values (dimension clamping, quality → steps/guidance), so the
// provider only has to encode an already-valid request.

import {
  clampToBounds,
  getImageModel,
  getImageModelParams,
  type ImageModelRegistryEntry,
} from "./image-models";
import {
  IMAGE_PROVIDER_ID,
  IMAGE_PROVIDER_LABEL,
  type ImageHealthStatus,
  type ImageModelCapabilities,
  type ImageModelDescriptor,
  type ImageProviderCapabilities,
  type ImageQuality,
} from "./image-types";

/** Dimensions are always a multiple of this to keep diffusion models happy. */
const DIMENSION_STEP = 64;

/** Default long edge when the user gives only an aspect ratio. */
const DEFAULT_LONG_EDGE = 1024;

const capabilityCache = new Map<string, ImageModelCapabilities>();

function deriveCapabilities(entry: ImageModelRegistryEntry): ImageModelCapabilities {
  const params = getImageModelParams(entry.id);
  const supportsDimensions = params.has("width") && params.has("height");
  const widthBounds = entry.bounds.width;
  const heightBounds = entry.bounds.height;

  return {
    supportsGeneration: params.has("prompt"),
    supportsNegativePrompt: params.has("negative_prompt"),
    supportsSeed: params.has("seed"),
    supportsDimensions,
    supportsAspectRatio: supportsDimensions || params.has("aspect_ratio"),
    supportsSteps: Boolean(entry.steps) && params.has(entry.steps!.param),
    supportsGuidance: Boolean(entry.guidance) && params.has("guidance"),
    // No registered Workers AI text-to-image model accepts an input image, so
    // editing is unavailable by contract rather than by omission.
    supportsEditing: false,
    minWidth: supportsDimensions ? (widthBounds?.min ?? 256) : entry.nativeSize.width,
    maxWidth: supportsDimensions ? (widthBounds?.max ?? 2048) : entry.nativeSize.width,
    minHeight: supportsDimensions ? (heightBounds?.min ?? 256) : entry.nativeSize.height,
    maxHeight: supportsDimensions ? (heightBounds?.max ?? 2048) : entry.nativeSize.height,
    maxImages: entry.maxImages,
  };
}

/** Capabilities for a registry entry (cached). */
export function getCapabilitiesForEntry(entry: ImageModelRegistryEntry): ImageModelCapabilities {
  const cached = capabilityCache.get(entry.id);
  if (cached) return cached;
  const derived = Object.freeze(deriveCapabilities(entry));
  capabilityCache.set(entry.id, derived);
  return derived;
}

/**
 * Capabilities for a model id.
 *
 * @returns the model's capabilities, or a conservative prompt-only capability set
 *   when the id is not registered (callers should reject unknown ids instead).
 */
export function getImageModelCapabilities(id: string): ImageModelCapabilities {
  const entry = getImageModel(id);
  if (entry) return getCapabilitiesForEntry(entry);
  return {
    supportsGeneration: true,
    supportsNegativePrompt: false,
    supportsSeed: false,
    supportsDimensions: false,
    supportsAspectRatio: false,
    supportsSteps: false,
    supportsGuidance: false,
    supportsEditing: false,
    minWidth: 1024,
    maxWidth: 1024,
    minHeight: 1024,
    maxHeight: 1024,
    maxImages: 1,
  };
}

/**
 * Union the capabilities of the given models so the UI can enable a control when
 * *any* selectable model supports it. Used to drive the image dialog.
 */
export function getProviderCapabilities(modelIds: readonly string[]): ImageProviderCapabilities {
  const entries = modelIds
    .map(getImageModel)
    .filter((e): e is ImageModelRegistryEntry => Boolean(e));
  const caps = entries.map(getCapabilitiesForEntry);
  const some = (pick: (c: ImageModelCapabilities) => boolean) => caps.some(pick);
  const max = (pick: (c: ImageModelCapabilities) => number, fallback: number) =>
    caps.length ? Math.max(...caps.map(pick)) : fallback;
  const min = (pick: (c: ImageModelCapabilities) => number, fallback: number) =>
    caps.length ? Math.min(...caps.map(pick)) : fallback;

  return {
    provider: IMAGE_PROVIDER_ID,
    providerLabel: IMAGE_PROVIDER_LABEL,
    models: entries.map((entry) => entry.id),
    supportsGeneration: caps.length > 0,
    supportsNegativePrompt: some((c) => c.supportsNegativePrompt),
    supportsSeed: some((c) => c.supportsSeed),
    supportsDimensions: some((c) => c.supportsDimensions),
    supportsAspectRatio: some((c) => c.supportsAspectRatio),
    supportsSteps: some((c) => c.supportsSteps),
    supportsGuidance: some((c) => c.supportsGuidance),
    supportsEditing: false,
    minWidth: min((c) => c.minWidth, 1024),
    maxWidth: max((c) => c.maxWidth, 1024),
    minHeight: min((c) => c.minHeight, 1024),
    maxHeight: max((c) => c.maxHeight, 1024),
    maxImages: max((c) => c.maxImages, 1),
  };
}

/** Build the UI/API descriptor for one model. */
export function toModelDescriptor(
  entry: ImageModelRegistryEntry,
  health: { status: ImageHealthStatus; healthy: boolean; reason?: string },
  options: { recommended?: boolean } = {},
): ImageModelDescriptor {
  return {
    id: entry.id,
    label: entry.label,
    description: entry.description,
    badges: entry.badges,
    capabilities: getCapabilitiesForEntry(entry),
    status: health.status,
    healthy: health.healthy,
    ...(health.reason ? { reason: health.reason } : {}),
    recommended: options.recommended ?? false,
  };
}

// ---------------------------------------------------------------------------
// Request shaping
// ---------------------------------------------------------------------------

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** Reduce pixel dimensions to a display aspect ratio such as `16:9`. */
export function toAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/** Parse `"16:9"` into a numeric ratio. Returns `null` for malformed input. */
export function parseAspectRatio(value?: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.length !== 2) return null;
  const [w, h] = parts;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

function snap(value: number, minimum: number, maximum: number): number {
  const rounded = Math.round(value / DIMENSION_STEP) * DIMENSION_STEP;
  return Math.min(maximum, Math.max(minimum, rounded));
}

export interface DimensionRequest {
  width?: number;
  height?: number;
  aspectRatio?: string;
}

export interface ResolvedDimensions {
  width: number;
  height: number;
  aspectRatio: string;
  /** True when the model ignores size and produced its native resolution. */
  native: boolean;
}

/**
 * Resolve legal output dimensions for a model.
 *
 * Explicit width/height win, then the aspect ratio, then the model's native
 * size. Models that do not accept width/height (e.g. `flux-1-schnell`) always
 * report their native size so the gallery records the truth.
 */
export function resolveModelDimensions(
  entry: ImageModelRegistryEntry,
  request: DimensionRequest,
): ResolvedDimensions {
  const caps = getCapabilitiesForEntry(entry);
  if (!caps.supportsDimensions) {
    const { width, height } = entry.nativeSize;
    return { width, height, aspectRatio: toAspectRatio(width, height), native: true };
  }

  if (request.width && request.height) {
    const width = snap(request.width, caps.minWidth, caps.maxWidth);
    const height = snap(request.height, caps.minHeight, caps.maxHeight);
    return { width, height, aspectRatio: toAspectRatio(width, height), native: false };
  }

  const ratio = parseAspectRatio(request.aspectRatio);
  if (ratio) {
    const longEdge = Math.min(DEFAULT_LONG_EDGE, ratio >= 1 ? caps.maxWidth : caps.maxHeight);
    const rawWidth = ratio >= 1 ? longEdge : longEdge * ratio;
    const rawHeight = ratio >= 1 ? longEdge / ratio : longEdge;
    const width = snap(rawWidth, caps.minWidth, caps.maxWidth);
    const height = snap(rawHeight, caps.minHeight, caps.maxHeight);
    return {
      width,
      height,
      aspectRatio: request.aspectRatio ?? toAspectRatio(width, height),
      native: false,
    };
  }

  const width = snap(entry.nativeSize.width, caps.minWidth, caps.maxWidth);
  const height = snap(entry.nativeSize.height, caps.minHeight, caps.maxHeight);
  return { width, height, aspectRatio: toAspectRatio(width, height), native: false };
}

/** Diffusion steps for a model at the requested quality, clamped to bounds. */
export function resolveSteps(
  entry: ImageModelRegistryEntry,
  quality: ImageQuality,
): { param: "steps" | "num_steps"; value: number } | null {
  if (!entry.steps) return null;
  const { param, byQuality } = entry.steps;
  if (!getImageModelParams(entry.id).has(param)) return null;
  const clamped = clampToBounds(byQuality[quality], entry.bounds[param]);
  if (clamped === undefined) return null;
  return { param, value: Math.round(clamped) };
}

/** Guidance scale for a model at the requested quality, clamped to bounds. */
export function resolveGuidance(
  entry: ImageModelRegistryEntry,
  quality: ImageQuality,
): number | null {
  if (!entry.guidance) return null;
  if (!getImageModelParams(entry.id).has("guidance")) return null;
  const clamped = clampToBounds(entry.guidance.byQuality[quality], entry.bounds.guidance);
  return clamped === undefined ? null : clamped;
}

/** Seed value a model will accept, or `null` when it declares no seed param. */
export function resolveSeed(
  entry: ImageModelRegistryEntry,
  seed: number | undefined,
): number | null {
  if (seed === undefined) return null;
  if (!getImageModelParams(entry.id).has("seed")) return null;
  const clamped = clampToBounds(seed, entry.bounds.seed);
  return clamped === undefined ? null : Math.round(clamped);
}
