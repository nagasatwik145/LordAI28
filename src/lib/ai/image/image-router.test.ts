import { describe, it, expect, vi, beforeEach } from "vitest";

const generateMock = vi.fn();
const failingModel = { id: "" as string };

vi.mock("./cloudflare-provider", () => ({
  cloudflareImageProvider: {
    generate: (req: { model: string }) => generateMock(req),
    capabilities: () => ({}),
    authenticate: () => ({
      configured: true,
      missingEnv: [],
      accountIdPresent: true,
      tokenPresent: true,
      configuredModel: "@cf/black-forest-labs/flux-2-klein-9b",
    }),
    healthCheck: async () => ({
      provider: "cloudflare",
      providerLabel: "Cloudflare Workers AI",
      status: "healthy" as const,
      healthy: true,
      credentialsConfigured: true,
      missingEnv: [],
      configuredModel: "@cf/black-forest-labs/flux-2-klein-9b",
      checkedAt: Date.now(),
      models: [],
    }),
    listAvailableModels: async () => null,
  },
}));

import { routeImageRequest } from "./image-router";
import { ImageGenerationError } from "./image-errors";
import { DEFAULT_IMAGE_MODEL_ID } from "./image-models";

function okResult(model: string, width: number, height: number) {
  return {
    provider: "cloudflare" as const,
    model,
    images: ["data:image/png;base64,AAAA"],
    width,
    height,
    seed: undefined,
    retryCount: 0,
    generationTimeMs: 1,
    contractSource: "registry",
    inputMode: "json" as const,
  };
}

describe("image router", () => {
  beforeEach(() => {
    generateMock.mockReset();
    failingModel.id = "";
  });

  it("returns a normalized result for a successful generation", async () => {
    generateMock.mockImplementation(async (req: { model: string; width: number; height: number }) =>
      okResult(req.model, req.width, req.height),
    );
    const result = await routeImageRequest({ prompt: "a cat" });
    expect(result.provider).toBe("cloudflare");
    expect(result.model).toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(result.images).toHaveLength(1);
    expect(result.fallbackUsed).toBe(false);
    expect(result.attempts.every((a) => a.ok)).toBe(true);
  });

  it("falls back within Cloudflare only when the first model fails", async () => {
    generateMock.mockImplementation(
      async (req: { model: string; width: number; height: number }) => {
        if (req.model === failingModel.id) {
          throw new ImageGenerationError("PROVIDER_ERROR", "boom");
        }
        return okResult(req.model, req.width, req.height);
      },
    );
    // Force the head of the chain (default model) to fail.
    failingModel.id = DEFAULT_IMAGE_MODEL_ID;

    const result = await routeImageRequest({ prompt: "a dog" });
    expect(result.fallbackUsed).toBe(true);
    expect(result.model).not.toBe(DEFAULT_IMAGE_MODEL_ID);
    expect(result.model.startsWith("@cf/")).toBe(true);
    expect(result.images).toHaveLength(1);
    // First attempt recorded as a failure, second as success.
    const failed = result.attempts.find((a) => !a.ok);
    expect(failed?.model).toBe(DEFAULT_IMAGE_MODEL_ID);
  });

  it("throws ALL_MODELS_FAILED when every model fails", async () => {
    generateMock.mockRejectedValue(new ImageGenerationError("PROVIDER_ERROR", "boom"));
    await expect(routeImageRequest({ prompt: "x" })).rejects.toMatchObject({
      code: "ALL_MODELS_FAILED",
    });
  });

  it("rejects an empty prompt without calling the provider", async () => {
    await expect(routeImageRequest({ prompt: "  " })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(generateMock).not.toHaveBeenCalled();
  });
});
