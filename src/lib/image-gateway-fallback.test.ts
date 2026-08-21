import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

type ImageModelLike = {
  id: string;
  provider: string;
  capabilities: Record<string, unknown>;
  maxWidth: number;
  maxHeight: number;
  estimatedPrice?: number;
};

// End-to-end fallback behaviour with a mocked OpenRouter. Confirms the single
// most important production requirement: when the selected model rejects the
// request, the gateway automatically tries the next compatible model instead of
// stopping (the original failure mode).

type ParamSchema =
  | { type: "enum"; values: string[] }
  | { type: "range"; min: number; max: number }
  | { type: "boolean" };

type RemoteModel = {
  id: string;
  architecture: { output_modalities: string[] };
  supported_parameters: Record<string, ParamSchema>;
};

const REGISTRY = [
  {
    id: "x-ai/grok-imagine-image-2.0",
    label: "Grok Imagine 2",
    provider: "openrouter" as const,
    capabilities: {
      supportsQuality: true,
      supportsResolution: true,
      maxImages: 4,
      maxImagesPerRequest: 1,
      supportsSeed: false,
    },
    maxWidth: 2048,
    maxHeight: 2048,
    estimatedPrice: 0.04,
  },
  {
    id: "black-forest-labs/flux.2-max",
    label: "FLUX 2 Max",
    provider: "openrouter" as const,
    capabilities: {
      supportsQuality: false,
      supportsResolution: false,
      maxImages: 4,
      maxImagesPerRequest: 1,
      supportsSeed: true,
    },
    maxWidth: 2048,
    maxHeight: 2048,
    estimatedPrice: 0.08,
  },
];

const catalog: RemoteModel[] = [
  {
    id: "x-ai/grok-imagine-image-2.0",
    architecture: { output_modalities: ["image"] },
    supported_parameters: {
      resolution: { type: "enum", values: ["1K", "2K"] },
      aspect_ratio: { type: "enum", values: ["1:1", "16:9", "4:3", "auto"] },
      quality: { type: "enum", values: ["low", "medium"] },
      n: { type: "range", min: 1, max: 1 },
    },
  },
  {
    id: "black-forest-labs/flux.2-max",
    architecture: { output_modalities: ["image"] },
    supported_parameters: {
      aspect_ratio: { type: "enum", values: ["1:1", "16:9", "4:3", "auto"] },
      seed: { type: "boolean" },
      n: { type: "range", min: 1, max: 1 },
    },
  },
];

vi.mock("@/lib/gateway-config", () => ({
  GATEWAY_CONFIG: {},
  IMAGE_CONFIG: {
    providerTimeoutMs: 90_000,
    catalogTimeoutMs: 10_000,
    catalogTtlMs: 30 * 60_000,
    maxAttemptsPerModel: 3,
    maxTotalAttempts: 10,
    maxPayloadRepairs: 2,
    requestDeadlineMs: 150_000,
    maxParallelImages: 4,
    healthTtlByStatus: {},
    healthTtlDefaultMs: 30_000,
  },
}));

vi.mock("@/lib/lord-config", () => ({
  IMAGE_MODELS: [
    {
      id: "x-ai/grok-imagine-image-2.0",
      label: "Grok Imagine 2",
      provider: "openrouter",
      capabilities: {
        supportsQuality: true,
        supportsResolution: true,
        maxImages: 4,
        maxImagesPerRequest: 1,
        supportsSeed: false,
      },
      maxWidth: 2048,
      maxHeight: 2048,
      estimatedPrice: 0.04,
    },
    {
      id: "black-forest-labs/flux.2-max",
      label: "FLUX 2 Max",
      provider: "openrouter",
      capabilities: {
        supportsQuality: false,
        supportsResolution: false,
        maxImages: 4,
        maxImagesPerRequest: 1,
        supportsSeed: true,
      },
      maxWidth: 2048,
      maxHeight: 2048,
      estimatedPrice: 0.08,
    },
  ],
  DEFAULT_IMAGE_MODEL_ID: "x-ai/grok-imagine-image-2.0",
  getImageModel: (id?: string) =>
    (
      [
        {
          id: "x-ai/grok-imagine-image-2.0",
          provider: "openrouter",
          capabilities: {
            supportsQuality: true,
            supportsResolution: true,
            maxImages: 4,
            maxImagesPerRequest: 1,
            supportsSeed: false,
          },
          maxWidth: 2048,
          maxHeight: 2048,
          estimatedPrice: 0.04,
        },
        {
          id: "black-forest-labs/flux.2-max",
          provider: "openrouter",
          capabilities: {
            supportsQuality: false,
            supportsResolution: false,
            maxImages: 4,
            maxImagesPerRequest: 1,
            supportsSeed: true,
          },
          maxWidth: 2048,
          maxHeight: 2048,
          estimatedPrice: 0.08,
        },
      ] as unknown as ImageModelLike[]
    ).find((m) => m.id === (id ?? "x-ai/grok-imagine-image-2.0")),
}));

vi.mock("@/lib/gateway-logger", () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    startupValidation: () => {},
    startupBanner: () => {},
  }),
}));

vi.mock("@/lib/ai-gateway.server", () => ({
  validateApiKey: () => ({ valid: true }),
  getGatewayInfrastructure: () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    healthCache: {
      get: () => undefined,
      set: () => {},
      clear: () => {},
      isHealthy: () => true,
    },
    circuitBreaker: {
      isOpen: () => false,
      recordSuccess: () => {},
      recordFailure: () => {},
    },
  }),
}));
vi.mock("@/lib/image-prompt", () => ({
  enhanceImagePrompt: (prompt: string) => ({ prompt, profile: "photorealistic" as const }),
  inferImagePromptProfile: () => "photorealistic" as const,
}));

import {
  generateImageWithFallback,
  __setImageCatalog,
  __resetImageGateway,
} from "./image-gateway.server";

const catalogMap = () => new Map(catalog.map((m) => [m.id, m]));

describe("image gateway automatic fallback", () => {
  beforeEach(() => {
    __resetImageGateway();
    __setImageCatalog(catalogMap());
    process.env.OPENROUTER_API_KEY = "sk-test";
  });
  afterEach(() => vi.restoreAllMocks());

  it("falls back to the next compatible model after the selected model rejects the payload", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      calls.push({ url: _url, body });
      const modelId: string = body.model;
      if (modelId === "x-ai/grok-imagine-image-2.0") {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'No provider supports the requested parameter(s): quality "high". Accepted: low, medium',
            },
          }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ data: [{ url: "https://example.com/flux.png" }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await generateImageWithFallback({
      prompt: "a red apple",
      model: "x-ai/grok-imagine-image-2.0",
      quality: "high",
    });

    expect(result.model).toBe("black-forest-labs/flux.2-max");
    expect(result.fallbackCount).toBeGreaterThan(0);
    expect(result.imageUrl).toBe("https://example.com/flux.png");
    // The rejecting model must have been retried with a repaired payload first.
    const grokCalls = calls.filter(
      (c) => c.body && (c.body as { model?: string }).model === "x-ai/grok-imagine-image-2.0",
    );
    expect(grokCalls.length).toBeGreaterThan(0);
  });

  it("returns a user-safe error (not a generic one) when every model fails", async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: { message: "Insufficient credits." } }), {
        status: 402,
      });
    }) as unknown as typeof fetch;

    await expect(
      generateImageWithFallback({ prompt: "a red apple", model: "x-ai/grok-imagine-image-2.0" }),
    ).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      fatal: true,
      message: expect.stringContaining("credits"),
    });
  });
});
