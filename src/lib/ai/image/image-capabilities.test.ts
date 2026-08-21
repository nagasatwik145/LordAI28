import { describe, it, expect } from "vitest";
import {
  toAspectRatio,
  parseAspectRatio,
  resolveModelDimensions,
  resolveSteps,
  resolveGuidance,
  resolveSeed,
  getProviderCapabilities,
} from "./image-capabilities";
import { getImageModel } from "./image-models";

const schnell = getImageModel("@cf/black-forest-labs/flux-1-schnell")!;
const sdxl = getImageModel("@cf/bytedance/stable-diffusion-xl-lightning")!;
const klein = getImageModel("@cf/black-forest-labs/flux-2-klein-9b")!;

describe("image capability resolution", () => {
  it("reduces pixel dimensions to a stable aspect ratio string", () => {
    expect(toAspectRatio(1920, 1080)).toBe("16:9");
    expect(toAspectRatio(1024, 1024)).toBe("1:1");
  });

  it("parses aspect ratios and rejects garbage", () => {
    expect(parseAspectRatio("16:9")).toBeCloseTo(16 / 9);
    expect(parseAspectRatio("nonsense")).toBeNull();
    expect(parseAspectRatio("")).toBeNull();
  });

  it("snaps dimensions to multiples of 64 within bounds", () => {
    const dims = resolveModelDimensions(sdxl, { width: 1000, height: 1000 });
    expect(dims.width % 64).toBe(0);
    expect(dims.height % 64).toBe(0);
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(1024);
  });

  it("reports the native size for models that ignore dimensions", () => {
    const dims = resolveModelDimensions(schnell, { width: 2000, height: 500 });
    expect(dims.native).toBe(true);
    expect(dims.width).toBe(1024);
    expect(dims.height).toBe(1024);
  });

  it("derives steps and guidance only when the model declares them", () => {
    // FLUX.1 schnell declares steps only.
    const steps = resolveSteps(schnell, "high");
    expect(steps).toEqual({ param: "steps", value: 8 });
    expect(resolveGuidance(schnell, "high")).toBeNull();

    // SDXL Lightning declares both steps (num_steps) and guidance.
    const sdxlSteps = resolveSteps(sdxl, "balanced");
    expect(sdxlSteps).toEqual({ param: "num_steps", value: 12 });
    expect(resolveGuidance(sdxl, "balanced")).toBe(7.5);
  });

  it("drops the seed for models without a seed parameter", () => {
    expect(resolveSeed(schnell, 123)).toBeNull();
    expect(resolveSeed(klein, 123)).toBe(123);
  });

  it("unions per-model capabilities for the provider UI", () => {
    const caps = getProviderCapabilities([
      "@cf/black-forest-labs/flux-1-schnell",
      "@cf/bytedance/stable-diffusion-xl-lightning",
    ]);
    expect(caps.provider).toBe("cloudflare");
    // SDXL supports negative prompt / seed, so the union enables those controls.
    expect(caps.supportsNegativePrompt).toBe(true);
    expect(caps.supportsSeed).toBe(true);
    // No registered model edits, so editing stays disabled everywhere.
    expect(caps.supportsEditing).toBe(false);
  });
});
