import { describe, expect, it, beforeEach, vi } from "vitest";

type ImageModelLike = {
  id: string;
  provider: string;
  capabilities: Record<string, unknown>;
  maxWidth: number;
  maxHeight: number;
  estimatedPrice?: number;
};

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
    },
    maxWidth: 2048,
    maxHeight: 2048,
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
    },
    maxWidth: 2048,
    maxHeight: 2048,
  },
];

const catalog: RemoteModel[] = [
  {
    id: "x-ai/grok-imagine-image-2.0",
    architecture: { output_modalities: ["image"] },
    supported_parameters: {
      resolution: { type: "enum", values: ["1K", "2K"] },
      aspect_ratio: {
        type: "enum",
        values: [
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9",
          "2:3",
          "3:2",
          "9:19.5",
          "19.5:9",
          "9:20",
          "20:9",
          "1:2",
          "2:1",
          "auto",
        ],
      },
      quality: { type: "enum", values: ["low", "medium"] },
      n: { type: "range", min: 1, max: 1 },
    },
  },
  {
    id: "black-forest-labs/flux.2-max",
    architecture: { output_modalities: ["image"] },
    supported_parameters: {
      aspect_ratio: {
        type: "enum",
        values: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "auto"],
      },
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
      },
      maxWidth: 2048,
      maxHeight: 2048,
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
      },
      maxWidth: 2048,
      maxHeight: 2048,
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
          },
          maxWidth: 2048,
          maxHeight: 2048,
        },
        {
          id: "black-forest-labs/flux.2-max",
          provider: "openrouter",
          capabilities: {
            supportsQuality: false,
            supportsResolution: false,
            maxImages: 4,
            maxImagesPerRequest: 1,
          },
          maxWidth: 2048,
          maxHeight: 2048,
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

// Provide a no-op health cache/circuit breaker so the gateway imports cleanly.
vi.mock("@/lib/ai-gateway.server", () => ({
  validateApiKey: () => ({ valid: true }),
  getGatewayInfrastructure: () => ({
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    healthCache: { get: () => undefined, set: () => {} },
    circuitBreaker: { isOpen: () => false, recordSuccess: () => {}, recordFailure: () => {} },
  }),
}));
vi.mock("@/lib/image-prompt", () => ({
  enhanceImagePrompt: (prompt: string) => ({ prompt, profile: "photorealistic" as const }),
  inferImagePromptProfile: () => "photorealistic" as const,
}));

import {
  buildPayloadExport,
  classifyExport,
  repairPayloadExport,
} from "./image-gateway-helpers.test-helper";

function makeRemote(id: string): RemoteModel {
  return JSON.parse(JSON.stringify(catalog.find((m) => m.id === id)!));
}

describe("image payload builder", () => {
  it("maps quality 'high' to the model's accepted enum (low/medium) instead of sending 'high'", () => {
    const remote = makeRemote("x-ai/grok-imagine-image-2.0");
    const model = REGISTRY[0];
    const { body } = buildPayloadExport(
      { prompt: "x", quality: "high" },
      model as never,
      remote as never,
      "x",
      1024,
      1024,
    );
    expect(body.quality).toBe("medium");
    expect(body.quality).not.toBe("high");
  });

  it("never sends a resolution tier to a model that has no resolution parameter (FLUX sizes by aspect ratio)", () => {
    const remote = makeRemote("black-forest-labs/flux.2-max");
    const model = REGISTRY[1];
    const { body } = buildPayloadExport(
      { prompt: "x", quality: "high" },
      model as never,
      remote as never,
      "x",
      1024,
      1024,
    );
    expect(body.resolution).toBeUndefined();
    expect(body.quality).toBeUndefined();
    expect(body.aspect_ratio).toBe("1:1");
  });

  it("snaps an off-grid aspect ratio to the nearest supported value", () => {
    const remote = makeRemote("x-ai/grok-imagine-image-2.0");
    const model = REGISTRY[0];
    const { body } = buildPayloadExport(
      { prompt: "x" },
      model as never,
      remote as never,
      "x",
      1536,
      864, // 16:9
    );
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("folds a negative prompt into the prompt text (no model supports a native param)", () => {
    const remote = makeRemote("x-ai/grok-imagine-image-2.0");
    const { body } = buildPayloadExport(
      { prompt: "a cat", negativePrompt: "no dogs" },
      REGISTRY[0] as never,
      remote as never,
      "a cat",
      1024,
      1024,
    );
    expect(String(body.prompt)).toContain("Avoid: no dogs");
    expect(body.negative_prompt).toBeUndefined();
  });
});

describe("image error classification", () => {
  it("classifies 402 as quota (fatal, account-level)", () => {
    const err = classifyExport(402, '{"error":{"message":"Insufficient credits."}}');
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.fatal).toBe(true);
    expect(err.retryable).toBe(false);
  });

  it("classifies a quality rejection as a repairable parameter error (not content)", () => {
    const err = classifyExport(
      400,
      '{"error":{"message":"No provider supports the requested parameter(s): quality \\"high\\". Accepted: low, medium"}}',
    );
    expect(err.code).toBe("MODEL_REJECTED_PARAMS");
    expect(err.retryable).toBe(false);
    expect(err.fatal).toBe(false);
  });

  it("classifies 429 as rate limited and retryable", () => {
    const err = classifyExport(429, "rate limited");
    expect(err.code).toBe("PROVIDER_RATE_LIMITED");
    expect(err.retryable).toBe(true);
  });
});

describe("image payload repair", () => {
  it("strips the unsupported parameter flagged by the provider", () => {
    const body = {
      model: "x-ai/grok-imagine-image-2.0",
      prompt: "x",
      quality: "high",
      resolution: "1K",
    };
    const fixed = repairPayloadExport(
      { ...body },
      "x-ai/grok-imagine-image-2.0",
      'No provider supports the requested parameter(s): quality "high". Accepted: low, medium',
    );
    expect(fixed).not.toBeNull();
    expect(fixed!.quality).toBeUndefined();
    expect(fixed!.resolution).toBe("1K");
  });
});
