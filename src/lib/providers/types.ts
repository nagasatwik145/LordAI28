// Shared types for image generation providers.
//
// Every provider (Puter, Cloudflare, OpenRouter, …) normalizes its output into
// `UnifiedImageResult` so the rest of LORD — the gallery, chat, analytics, and
// UI — always receives one common shape. No provider-specific object is allowed
// to reach the UI.

export type ImageProviderId = "puter" | "cloudflare" | "openrouter";

/** Common request shape understood by every image provider. */
export interface GenerateImageParams {
  prompt: string;
  /** Already-enhanced prompt, when the caller pre-enhances. */
  enhancedPrompt?: string;
  /** Preferred model id for the provider (provider-specific). */
  model?: string;
  /** "1:1" | "16:9" | "4:3" … */
  aspectRatio?: string;
  width?: number;
  height?: number;
  quality?: "fast" | "balanced" | "high";
  count?: number;
  seed?: number;
  negativePrompt?: string;
  enhancePrompt?: boolean;
}

/**
 * The single response contract for image generation. Every provider returns
 * exactly this shape. See STEP 5 of the integration spec.
 */
export interface UnifiedImageResult {
  provider: string;
  model: string;
  images: string[];
  generationTime: number;
  cost: number;
  requestId: string;
  /** Optional, user-safe generation diagnostics surfaced by the UI. */
  diagnostics?: ImageGenerationDiagnostics;
}

/**
 * User-safe, non-sensitive summary of how a generation resolved. Never includes
 * raw provider JSON, error bodies, or secrets.
 */
export interface ImageGenerationDiagnostics {
  /** The provider that actually produced the image. */
  provider: string;
  /** The model id that actually produced the image. */
  model: string;
  /** Human label for the model, when known. */
  modelLabel?: string;
  /** Whether the gateway fell back from the user's requested provider/model. */
  fallbackUsed: boolean;
  /** The provider/model the gateway fell back to, when applicable. */
  fallbackProvider?: string;
  fallbackModel?: string;
  /** Number of retries performed on the producing model. */
  retryCount: number;
  /** Approximate queue/wait time before generation started (ms). */
  queueTimeMs?: number;
  /** Total generation time (ms). */
  generationTimeMs?: number;
  /** True when the image could not be saved to the gallery. */
  persistenceWarning?: boolean;
}

export type ProviderHealthStatus =
  | "healthy"
  | "available"
  | "auth_required"
  | "auth_failed"
  | "rate_limited"
  | "unavailable"
  | "offline"
  | "error";

export interface ProviderHealth {
  status: ProviderHealthStatus;
  authenticated: boolean;
  available: boolean;
  rateLimited: boolean;
  reason?: string;
  checkedAt: number;
}

export interface ImageProviderCapabilities {
  supportsGeneration: boolean;
  supportsEditing: boolean;
  supportsAspectRatio: boolean;
  supportsSeed: boolean;
  supportsQuality: boolean;
  supportsNegativePrompt: boolean;
  maxImages: number;
}

/**
 * The interface every image provider must implement. Puter is the first
 * concrete implementation; Cloudflare/OpenRouter are satisfied by the existing
 * server-side gateway but keep the same contract so the registry stays uniform.
 */
export interface ImageProvider {
  readonly id: ImageProviderId;
  initialize(): Promise<void>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  isAuthenticated(): Promise<boolean>;
  generateImage(params: GenerateImageParams): Promise<UnifiedImageResult>;
  healthCheck(): Promise<ProviderHealth>;
}
