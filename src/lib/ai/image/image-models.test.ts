import { describe, it, expect } from "vitest";
import {
  IMAGE_MODEL_REGISTRY,
  DEFAULT_IMAGE_MODEL_ID,
  isRegisteredImageModel,
  resolveConfiguredModelId,
  buildFallbackChain,
  clampToBounds,
  getImageModel,
} from "./image-models";

describe("image model registry", () => {
  it("is sorted by fallback priority and the first entry is the default model", () => {
    const priorities = IMAGE_MODEL_REGISTRY.map((m) => m.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
    expect(IMAGE_MODEL_REGISTRY[0].id).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(DEFAULT_IMAGE_MODEL_ID).toBe("@cf/black-forest-labs/flux-1-schnell");
  });

  it("contains the supported Cloudflare-first, OpenRouter-fallback registry", () => {
    expect(IMAGE_MODEL_REGISTRY.filter((m) => m.provider === "cloudflare")).toHaveLength(4);
    expect(IMAGE_MODEL_REGISTRY.filter((m) => m.provider === "openrouter")).toHaveLength(4);
  });

  it("rejects unknown model ids but keeps a registered one", () => {
    expect(isRegisteredImageModel("openrouter/flux")).toBe(false);
    expect(isRegisteredImageModel(DEFAULT_IMAGE_MODEL_ID)).toBe(true);
    expect(getImageModel("nope")).toBeUndefined();
  });

  it("falls back to the default when CLOUDFLARE_IMAGE_MODEL is unknown", () => {
    const resolved = resolveConfiguredModelId("not-a-real-model");
    expect(resolved.id).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(resolved.warning).toBeTruthy();
    expect(resolveConfiguredModelId("@cf/black-forest-labs/flux-1-dev").id).toBe(
      "@cf/black-forest-labs/flux-1-dev",
    );
  });

  it("builds a provider-aware fallback chain with no duplicates", () => {
    const chain = buildFallbackChain({ requested: "qwen/qwen-image-3-pro" });
    const ids = chain.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chain.some((m) => m.id === "qwen/qwen-image-3-pro")).toBe(true);
    expect(chain.some((m) => m.provider === "cloudflare")).toBe(true);
    // Requested model is attempted first.
    expect(chain[0].id).toBe("qwen/qwen-image-3-pro");
  });

  it("exposes a sane selectable chain when a health filter disqualifies everything", () => {
    const chain = buildFallbackChain({ isSelectable: () => false });
    // Never returns an empty chain, so the user gets a real provider error.
    expect(chain.length).toBeGreaterThan(0);
  });

  it("clamps numeric values into declared bounds", () => {
    expect(clampToBounds(5000, { min: 1, max: 8 })).toBe(8);
    expect(clampToBounds(-3, { min: 0 })).toBe(0);
    expect(clampToBounds(4, { min: 1, max: 8 })).toBe(4);
    expect(clampToBounds(Number.NaN, { min: 1, max: 8 })).toBeUndefined();
  });
});
