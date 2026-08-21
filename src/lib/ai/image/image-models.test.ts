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
    // FLUX 2 Klein is the documented head of the chain.
    expect(DEFAULT_IMAGE_MODEL_ID).toBe("@cf/black-forest-labs/flux-2-klein-9b");
  });

  it("only contains Cloudflare models", () => {
    for (const model of IMAGE_MODEL_REGISTRY) {
      expect(model.id.startsWith("@cf/")).toBe(true);
    }
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
    expect(resolveConfiguredModelId("@cf/bytedance/stable-diffusion-xl-lightning").id).toBe(
      "@cf/bytedance/stable-diffusion-xl-lightning",
    );
  });

  it("builds a Cloudflare-only fallback chain with no duplicates", () => {
    const chain = buildFallbackChain({ requested: "@cf/leonardo/phoenix-1.0" });
    const ids = chain.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(chain.some((m) => m.id === "@cf/leonardo/phoenix-1.0")).toBe(true);
    expect(chain.every((m) => m.id.startsWith("@cf/"))).toBe(true);
    // Requested model is attempted first.
    expect(chain[0].id).toBe("@cf/leonardo/phoenix-1.0");
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
