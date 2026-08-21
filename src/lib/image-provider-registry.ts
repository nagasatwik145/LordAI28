// Image Provider Registry — the single source of truth for image generation.
//
// The UI, the client gateway, analytics, and health monitoring all read from
// here. Adding a provider means adding one entry; nothing else hard-codes
// provider metadata.
//
// Provider execution model:
//   - "puter"      → runs client-side (browser, Puter.js)
//   - "cloudflare" → runs server-side; talks directly to Cloudflare Workers AI
//                    via the dedicated CloudflareImageProvider.
//   - "openrouter" → runs server-side via /api/images (OpenRouter Images API)

import type { ImageProviderCapabilities, ImageProviderId } from "./providers/types";
import { PUTER_CAPABILITIES, PUTER_DEFAULT_MODEL } from "./providers/puter-provider";
import { IMAGE_MODELS } from "./lord-config";

// Default Cloudflare Workers AI model (mirrors CLOUDFLARE_DEFAULT_IMAGE_MODEL in
// providers/cloudflare-provider.ts). Kept as a local literal here so the shared
// registry never has to import the server-only provider module into the client.
const CLOUDFLARE_DEFAULT_IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-9b";

export type ImageProviderType = "client" | "server";

export type ImageProviderHealthStatus =
  | "healthy"
  | "available"
  | "unavailable"
  | "offline"
  | "rate_limited"
  | "auth_required"
  | "auth_failed"
  | "error";

export interface ImageProviderRegistration {
  id: ImageProviderId;
  displayName: string;
  type: ImageProviderType;
  /** Whether the user must authenticate (Puter) before this provider is used. */
  authRequired: boolean;
  capabilities: ImageProviderCapabilities;
  /** Provider-specific model ids the registry knows about. */
  supportedModels: string[];
  /** Last known health from the monitoring layer. */
  healthStatus: ImageProviderHealthStatus;
  description: string;
}

const OPENROUTER_CAPABILITIES: ImageProviderCapabilities = {
  supportsGeneration: true,
  supportsEditing: true,
  supportsAspectRatio: true,
  supportsSeed: true,
  supportsQuality: true,
  supportsNegativePrompt: true,
  maxImages: 8,
};

const CLOUDFLARE_CAPABILITIES: ImageProviderCapabilities = {
  supportsGeneration: true,
  supportsEditing: false,
  supportsAspectRatio: true,
  supportsSeed: false,
  supportsQuality: true,
  supportsNegativePrompt: false,
  maxImages: 4,
};

const PUTER_MODELS = [
  PUTER_DEFAULT_MODEL,
  "openai/gpt-image-1.5",
  "openai/gpt-image-1-mini",
  "google/gemini-3-pro-image-preview",
  "google/gemini-3.1-flash-image-preview",
  "x-ai/grok-imagine-image",
  "black-forest-labs/flux-2-pro",
  "qwen/qwen-image-2.0-pro",
];

export const IMAGE_PROVIDER_REGISTRY: Record<ImageProviderId, ImageProviderRegistration> = {
  puter: {
    id: "puter",
    displayName: "Puter",
    type: "client",
    authRequired: true,
    capabilities: PUTER_CAPABILITIES,
    supportedModels: PUTER_MODELS,
    healthStatus: "available",
    description: "Free, keyless image generation via Puter.js (client-side).",
  },
  cloudflare: {
    id: "cloudflare",
    displayName: "Cloudflare",
    type: "server",
    authRequired: false,
    capabilities: CLOUDFLARE_CAPABILITIES,
    supportedModels: [CLOUDFLARE_DEFAULT_IMAGE_MODEL],
    healthStatus: "available",
    description:
      "Server-side image generation via Cloudflare Workers AI (configurable model CLOUDFLARE_IMAGE_MODEL).",
  },
  openrouter: {
    id: "openrouter",
    displayName: "OpenRouter",
    type: "server",
    authRequired: false,
    capabilities: OPENROUTER_CAPABILITIES,
    supportedModels: IMAGE_MODELS.map((m) => m.id),
    healthStatus: "available",
    description: "Server-side generation via the OpenRouter Images API.",
  },
};

/** The global fallback order. Puter is tried first (free), then server providers. */
export const IMAGE_PROVIDER_ORDER: ImageProviderId[] = ["puter", "cloudflare", "openrouter"];

export function getImageProviderRegistration(id: ImageProviderId): ImageProviderRegistration {
  return IMAGE_PROVIDER_REGISTRY[id];
}

export function listImageProviders(): ImageProviderRegistration[] {
  return IMAGE_PROVIDER_ORDER.map((id) => IMAGE_PROVIDER_REGISTRY[id]);
}

/** Providers the client can execute directly (everything else goes to the server). */
export function isClientProvider(id: ImageProviderId): boolean {
  return IMAGE_PROVIDER_REGISTRY[id].type === "client";
}

/** Ordered candidate list for a user selection. Keeps the chosen provider first. */
export function resolveProviderOrder(selection: "auto" | ImageProviderId): ImageProviderId[] {
  if (selection === "auto") return [...IMAGE_PROVIDER_ORDER];
  return [selection, ...IMAGE_PROVIDER_ORDER.filter((id) => id !== selection)];
}
