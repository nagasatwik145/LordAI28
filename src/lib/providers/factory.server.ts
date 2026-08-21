// Server-side image provider factory.
//
// Maps a provider id to its concrete {@link ImageProvider} instance. This is the
// server counterpart to `image-provider-registry.ts` (which holds user-facing
// *metadata*); the registry answers "what providers exist and what can they do",
// while this factory answers "which instance should handle this request".
//
// OpenRouter is intentionally absent: it is served by the dedicated OpenRouter
// image gateway (`generateImageWithFallback` in image-gateway.server.ts), not by
// a standalone `ImageProvider` instance. Puter is client-only but is safe to
// import on the server (its SDK is lazy-loaded and guarded by `window`).

import type { ImageProvider, ImageProviderId } from "./types";
import { puterProvider } from "./puter-provider";
import { cloudflareProvider } from "./cloudflare-provider";

const PROVIDER_INSTANCES: Partial<Record<ImageProviderId, ImageProvider>> = {
  puter: puterProvider,
  cloudflare: cloudflareProvider,
};

/**
 * Resolve the concrete image provider instance for a provider id.
 *
 * @returns the provider instance, or `null` when the id is unknown or handled by
 *   a non-instance path (e.g. OpenRouter's gateway).
 */
export function getImageProvider(id: ImageProviderId): ImageProvider | null {
  return PROVIDER_INSTANCES[id] ?? null;
}

export { puterProvider, cloudflareProvider };
