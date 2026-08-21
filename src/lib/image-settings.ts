import type { ImageProviderId } from "@/lib/ai/image";

/**
 * Local, per-user defaults for image generation.
 *
 * Stored in localStorage (this is a single-user, local-first app per
 * IMPLEMENTATION_GUIDE) so no database migration is required. The Image
 * Generation panel reads these as starting values and the Settings screen lets
 * the operator change them. They never leave the browser except as part of a
 * generation request to the server gateway.
 */

export type ImageSizePreset = "square" | "portrait" | "landscape";

export interface ImageGenDefaults {
  defaultProvider: ImageProviderId;
  defaultModel: string;
  defaultResolution: ImageSizePreset;
  defaultAspectRatio: string;
  defaultImageCount: number;
  defaultQuality: "fast" | "balanced" | "high";
  enhancePrompt: boolean;
}

const STORAGE_KEY = "lord.image-gen.defaults";

export const DEFAULT_IMAGE_GEN: ImageGenDefaults = {
  defaultProvider: "cloudflare",
  defaultModel: "",
  defaultResolution: "square",
  defaultAspectRatio: "1:1",
  defaultImageCount: 1,
  defaultQuality: "high",
  enhancePrompt: true,
};

export function getImageGenDefaults(): ImageGenDefaults {
  if (typeof window === "undefined") return DEFAULT_IMAGE_GEN;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_IMAGE_GEN;
    return { ...DEFAULT_IMAGE_GEN, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_IMAGE_GEN;
  }
}

export function setImageGenDefaults(patch: Partial<ImageGenDefaults>): ImageGenDefaults {
  const next = { ...getImageGenDefaults(), ...patch };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

/** Map a size preset + aspect ratio to explicit pixel dimensions. */
export function resolveDimensions(
  preset: ImageSizePreset,
  aspectRatio: string,
): { width: number; height: number; ratio: string } {
  const ratio = aspectRatio || "1:1";
  const square = { width: 1024, height: 1024 };
  const byPreset: Record<ImageSizePreset, { width: number; height: number }> = {
    square: square,
    portrait: { width: 768, height: 1024 },
    landscape: { width: 1024, height: 768 },
  };
  // When an explicit non-1:1 ratio is chosen, honor it over the preset box.
  if (ratio !== "1:1") {
    const [w, h] = ratio.split(":").map(Number);
    if (w && h) {
      const long = 1024;
      return w >= h
        ? { width: long, height: Math.round((long * h) / w), ratio }
        : { width: Math.round((long * w) / h), height: long, ratio };
    }
  }
  return { ...byPreset[preset], ratio };
}
