// Puter.js image generation provider.
//
// Puter.js is a *client-side* (browser) library: it authenticates the end user
// against Puter's cloud and generates images directly from the browser, with no
// API keys or backend of our own. That is why this provider is intentionally
// client-only and is never imported by the server gateway.
//
// The server still owns the OpenRouter/Cloudflare fallback path; when Puter is
// unavailable or unauthenticated the client image gateway automatically routes
// the request to `/api/images` (see image-gateway-client.ts).

import type {
  GenerateImageParams,
  ImageProvider,
  ImageProviderCapabilities,
  ProviderHealth,
  UnifiedImageResult,
} from "./types";

// `puter` is loaded lazily so this module can be safely imported on the server
// during SSR without pulling in a browser-only SDK.
type PuterModule = {
  puter?: PuterLike;
  default?: PuterLike;
};
type PuterLike = {
  auth: {
    signIn: () => Promise<unknown>;
    signOut: () => Promise<void>;
    isSignedIn: () => Promise<boolean>;
  };
  ai: {
    txt2img: (prompt: string, options?: Record<string, unknown>) => Promise<HTMLImageElement>;
  };
};

let puterPromise: Promise<PuterLike> | null = null;

async function loadPuter(): Promise<PuterLike> {
  if (typeof window === "undefined") {
    throw new Error("puter_unavailable_ssr");
  }
  if (!puterPromise) {
    puterPromise = (import("@heyputer/puter.js") as Promise<unknown>).then((mod) => {
      const m = mod as PuterModule;
      const puter = m.puter ?? m.default;
      if (!puter || !puter.ai || !puter.auth) {
        throw new Error("puter_sdk_incomplete");
      }
      return puter;
    });
  }
  return puterPromise;
}

/** Models Puter exposes today; the registry mirrors this list as the source of truth. */
export const PUTER_DEFAULT_MODEL = "openai/gpt-image-2";

export const PUTER_CAPABILITIES: ImageProviderCapabilities = {
  supportsGeneration: true,
  supportsEditing: false,
  supportsAspectRatio: true,
  supportsSeed: true,
  supportsQuality: true,
  supportsNegativePrompt: true,
  maxImages: 4,
};

const ratioToXY = (ratio?: string): { w: number; h: number } | undefined => {
  if (!ratio) return undefined;
  const [w, h] = ratio.split(":").map((n) => parseInt(n, 10));
  if (!w || !h) return undefined;
  return { w, h };
};

const qualityToPuter = (quality?: "fast" | "balanced" | "high"): string | undefined => {
  if (quality === "high") return "high";
  if (quality === "balanced") return "medium";
  if (quality === "fast") return "low";
  return undefined;
};

/** Converts a Puter <img> element into a persistent data URL we can store. */
async function imageElementToDataUrl(img: HTMLImageElement): Promise<string> {
  const src = img.src;
  if (!src) throw new Error("puter_image_no_src");
  // Already self-contained (data URI) — safe to store as-is.
  if (src.startsWith("data:")) return src;
  // Blob URLs are session-scoped; fetch + re-encode so the image survives reloads.
  const res = await fetch(src);
  if (!res.ok) throw new Error("puter_image_fetch_failed");
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("puter_image_read_failed"));
    reader.readAsDataURL(blob);
  });
}

/** Clean, user-facing error — never leaks SDK internals or tokens. */
class PuterProviderError extends Error {
  constructor(
    public readonly code:
      | "UNAVAILABLE"
      | "AUTH_REQUIRED"
      | "AUTH_FAILED"
      | "GENERATION_FAILED"
      | "RATE_LIMITED"
      | "CONTENT_BLOCKED",
    message: string,
  ) {
    super(message);
    this.name = "PuterProviderError";
  }
}

export class PuterImageProvider implements ImageProvider {
  readonly id = "puter" as const;

  async initialize(): Promise<void> {
    // Touch the loader so the SDK is ready; failures are surfaced via healthCheck.
    if (typeof window === "undefined") return;
    try {
      await loadPuter();
    } catch {
      // initialize is best-effort; healthCheck reports the real status.
    }
  }

  async signIn(): Promise<void> {
    const puter = await loadPuter();
    try {
      await puter.auth.signIn();
    } catch (error) {
      throw new PuterProviderError("AUTH_FAILED", "Could not sign in to Puter. Please try again.");
    }
  }

  async signOut(): Promise<void> {
    const puter = await loadPuter();
    await puter.auth.signOut();
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const puter = await loadPuter();
      return await puter.auth.isSignedIn();
    } catch {
      return false;
    }
  }

  async generateImage(params: GenerateImageParams): Promise<UnifiedImageResult> {
    const started = performance.now();
    const requestId = crypto.randomUUID();
    const puter = await loadPuter();
    const authenticated = await puter.auth.isSignedIn().catch(() => false);
    if (!authenticated) {
      throw new PuterProviderError(
        "AUTH_REQUIRED",
        "Sign in with Puter to use free image generation.",
      );
    }

    const count = Math.min(Math.max(params.count ?? 1, 1), PUTER_CAPABILITIES.maxImages);
    const ratio = ratioToXY(params.aspectRatio);
    const images: string[] = [];

    for (let i = 0; i < count; i++) {
      const options: Record<string, unknown> = {
        prompt: params.enhancedPrompt ?? params.prompt,
        test_mode: false,
      };
      if (params.model) options.model = params.model;
      const quality = qualityToPuter(params.quality);
      if (quality) options.quality = quality;
      if (ratio) options.ratio = ratio;
      if (params.width && params.height) {
        options.width = params.width;
        options.height = params.height;
      }
      if (params.seed !== undefined) options.seed = params.seed + i;
      if (params.negativePrompt) options.negative_prompt = params.negativePrompt;

      let img: HTMLImageElement;
      try {
        img = await puter.ai.txt2img(params.enhancedPrompt ?? params.prompt, options);
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("rate") || message.includes("429")) {
          throw new PuterProviderError(
            "RATE_LIMITED",
            "Puter is rate limited right now. Trying another provider…",
          );
        }
        if (
          message.includes("safety") ||
          message.includes("policy") ||
          message.includes("moderation") ||
          message.includes("content")
        ) {
          throw new PuterProviderError(
            "CONTENT_BLOCKED",
            "This prompt could not be used to generate an image.",
          );
        }
        throw new PuterProviderError(
          "GENERATION_FAILED",
          "Puter could not generate the image. Trying another provider…",
        );
      }
      images.push(await imageElementToDataUrl(img));
    }

    return {
      provider: "Puter",
      model: params.model ?? PUTER_DEFAULT_MODEL,
      images,
      generationTime: Math.round(performance.now() - started),
      cost: 0,
      requestId,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = Date.now();
    if (typeof window === "undefined") {
      return {
        status: "offline",
        authenticated: false,
        available: false,
        rateLimited: false,
        reason: "server_context",
        checkedAt,
      };
    }
    try {
      const puter = await loadPuter();
      const authenticated = await puter.auth.isSignedIn().catch(() => false);
      return {
        status: authenticated ? "healthy" : "auth_required",
        authenticated,
        available: true,
        rateLimited: false,
        reason: authenticated ? undefined : "Not signed in to Puter",
        checkedAt,
      };
    } catch {
      return {
        status: "unavailable",
        authenticated: false,
        available: false,
        rateLimited: false,
        reason: "Puter SDK unavailable",
        checkedAt,
      };
    }
  }
}

export const puterProvider = new PuterImageProvider();
export { PuterProviderError };
