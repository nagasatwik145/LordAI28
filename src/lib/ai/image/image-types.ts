// Contracts for the image pipeline.
//
// These types are isomorphic (safe in the browser and on the server) and contain
// no provider transport details, so the UI, the API routes, and the provider all
// speak exactly one language. Nothing here imports chat code: the image pipeline
// is fully independent of chat routing.

import type { ImageErrorCode } from "./image-errors";
import type { ImagePromptProfile } from "./image-prompt";

/** The only image provider LORD supports. */
export type ImageProviderId = "cloudflare";

export const IMAGE_PROVIDER_ID: ImageProviderId = "cloudflare";
export const IMAGE_PROVIDER_LABEL = "Cloudflare Workers AI";

export type ImageQuality = "fast" | "balanced" | "high";

/** How a model's HTTP body must be encoded (Cloudflare differs per model). */
export type ImageInputMode = "json" | "multipart";

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * What a single model can actually do. Derived from the registry (and validated
 * against the live Workers AI schema), never guessed from the model name.
 */
export interface ImageModelCapabilities {
  supportsGeneration: boolean;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsDimensions: boolean;
  supportsAspectRatio: boolean;
  supportsSteps: boolean;
  supportsGuidance: boolean;
  /** Editing/img2img is not offered by any registered model today. */
  supportsEditing: boolean;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  /** Highest number of images LORD will request for one user request. */
  maxImages: number;
}

/** The union of every healthy model's capabilities, used to drive the UI. */
export interface ImageProviderCapabilities extends ImageModelCapabilities {
  provider: ImageProviderId;
  providerLabel: string;
  /** Model ids that are healthy and selectable right now. */
  models: string[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** A user-level image request (the shape accepted by `/api/images`). */
export interface ImageGenerationRequest {
  prompt: string;
  /** Registry model id. Unknown ids are rejected — never inferred. */
  model?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  quality?: ImageQuality;
  count?: number;
  seed?: number;
  enhancePrompt?: boolean;
  profile?: ImagePromptProfile;
  conversationId?: string | null;
  projectId?: string | null;
}

/** A single, fully-resolved provider call for one model. */
export interface ProviderGenerateRequest {
  requestId: string;
  model: string;
  /** Final prompt text (already enhanced when requested). */
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  aspectRatio?: string;
  quality: ImageQuality;
  seed?: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Normalized provider output. `images` are always `data:` URLs. */
export interface ProviderGenerateResult {
  provider: ImageProviderId;
  model: string;
  images: string[];
  width: number;
  height: number;
  seed?: number;
  /** Retries performed inside the provider for this model. */
  retryCount: number;
  generationTimeMs: number;
  /** Where the request contract came from (schema / registry / probe). */
  contractSource: string;
  inputMode: ImageInputMode;
}

/** One model attempt, surfaced so the UI can explain what happened. */
export interface ImageAttempt {
  model: string;
  modelLabel: string;
  ok: boolean;
  status: number;
  code?: ImageErrorCode;
  reason?: string;
  retries: number;
  durationMs: number;
}

/** The router's normalized success payload. */
export interface ImageGenerationResult {
  provider: ImageProviderId;
  providerLabel: string;
  requestId: string;
  /** Model that actually produced the images. */
  model: string;
  modelLabel: string;
  /** Model that was requested (may differ after fallback). */
  requestedModel: string;
  requestedModelLabel: string;
  fallbackUsed: boolean;
  fallbackCount: number;
  retryCount: number;
  images: string[];
  prompt: string;
  enhancedPrompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  aspectRatio: string;
  seed?: number;
  quality: ImageQuality;
  queueTimeMs: number;
  generationTimeMs: number;
  estimatedCost: number;
  attempts: ImageAttempt[];
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export type ImageHealthStatus =
  | "healthy"
  | "degraded"
  | "missing_credentials"
  | "invalid_credentials"
  | "model_unavailable"
  | "rate_limited"
  | "offline"
  | "unknown";

export interface ImageModelHealth {
  model: string;
  label: string;
  status: ImageHealthStatus;
  healthy: boolean;
  reason?: string;
  checkedAt: number;
}

export interface ImageProviderHealth {
  provider: ImageProviderId;
  providerLabel: string;
  status: ImageHealthStatus;
  healthy: boolean;
  /** True when both account id and API token are configured. */
  credentialsConfigured: boolean;
  /** Environment variables that are required but missing. */
  missingEnv: string[];
  configuredModel: string;
  latencyMs?: number;
  reason?: string;
  checkedAt: number;
  models: ImageModelHealth[];
}

// ---------------------------------------------------------------------------
// Provider abstraction
// ---------------------------------------------------------------------------

/** Result of the provider's credential check (no network call). */
export interface ImageProviderAuth {
  configured: boolean;
  missingEnv: string[];
  accountIdPresent: boolean;
  tokenPresent: boolean;
  /** Model configured via `CLOUDFLARE_IMAGE_MODEL`, already validated. */
  configuredModel: string;
}

/**
 * The contract every image provider implements. Cloudflare is the only
 * implementation; the interface exists so the router never depends on
 * Cloudflare-specific details and a future provider cannot leak its own shapes
 * into the UI.
 */
export interface ImageProvider {
  readonly id: ImageProviderId;
  readonly label: string;
  /** Report credential state (never throws, never performs I/O). */
  authenticate(): ImageProviderAuth;
  /** Submit one request for one model and return normalized output. */
  generate(request: ProviderGenerateRequest): Promise<ProviderGenerateResult>;
  /** Capabilities for a model id (or the provider default). */
  capabilities(model?: string): ImageModelCapabilities;
  /** Credential + connectivity + model-availability probe (no billable call). */
  healthCheck(models?: readonly string[]): Promise<ImageProviderHealth>;
  /** Text-to-image model ids available on the account, or null if unreachable. */
  listAvailableModels(): Promise<string[] | null>;
}

// ---------------------------------------------------------------------------
// HTTP wire contracts (shared by `/api/images*` and the client service)
// ---------------------------------------------------------------------------

export interface ImageGenerationSuccessBody {
  success: true;
  requestId: string;
  provider: ImageProviderId;
  providerLabel: string;
  model: string;
  modelLabel: string;
  requestedModel: string;
  requestedModelLabel: string;
  fallbackUsed: boolean;
  fallbackCount: number;
  retryCount: number;
  imageUrl: string;
  images: string[];
  width: number;
  height: number;
  aspectRatio: string;
  seed?: number;
  enhancedPrompt: string;
  generationTime: number;
  queueTime: number;
  estimatedCost: number;
  attempts: ImageAttempt[];
  /** False when the gallery row could not be written (image still returned). */
  persisted: boolean;
  warning?: string;
}

export interface ImageModelDescriptor {
  id: string;
  label: string;
  description: string;
  badges: readonly string[];
  capabilities: ImageModelCapabilities;
  status: ImageHealthStatus;
  healthy: boolean;
  reason?: string;
  recommended: boolean;
}

export interface ImageModelsBody {
  success: true;
  provider: ImageProviderId;
  providerLabel: string;
  defaultModel: string;
  /** Healthy, selectable models in fallback order. */
  models: ImageModelDescriptor[];
  /** Every registered model, including unhealthy ones (for diagnostics). */
  allModels: ImageModelDescriptor[];
  health: ImageProviderHealth;
}
