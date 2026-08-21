// Unit tests for the Puter image provider. The Puter SDK is mocked so we can
// validate the provider contract (init/sign-in/health/generation) and the
// unified response format without a browser or Puter account.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAuth = {
  signIn: vi.fn(async () => ({})),
  signOut: vi.fn(async () => {}),
  isSignedIn: vi.fn(async () => true),
};
const mockAi = {
  txt2img: vi.fn(async () => {
    const el = { src: "data:image/png;base64,AAAA" } as unknown as HTMLImageElement;
    return el;
  }),
};

vi.mock("@heyputer/puter.js", () => ({
  puter: { auth: mockAuth, ai: mockAi },
  default: { auth: mockAuth, ai: mockAi },
}));

// Minimal DOM so the (mocked) SDK + monitoring paths run under Node.
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

// Import after mocking.
const { puterProvider, PuterProviderError } = await import("./puter-provider");

describe("PuterImageProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.isSignedIn.mockResolvedValue(true);
  });

  it("initializes without throwing", async () => {
    await expect(puterProvider.initialize()).resolves.toBeUndefined();
  });

  it("signIn / signOut delegate to the SDK", async () => {
    await puterProvider.signIn();
    expect(mockAuth.signIn).toHaveBeenCalledOnce();
    await puterProvider.signOut();
    expect(mockAuth.signOut).toHaveBeenCalledOnce();
  });

  it("isAuthenticated reflects SDK state", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    expect(await puterProvider.isAuthenticated()).toBe(false);
    mockAuth.isSignedIn.mockResolvedValue(true);
    expect(await puterProvider.isAuthenticated()).toBe(true);
  });

  it("healthCheck reports healthy when signed in", async () => {
    mockAuth.isSignedIn.mockResolvedValue(true);
    const health = await puterProvider.healthCheck();
    expect(health.status).toBe("healthy");
    expect(health.authenticated).toBe(true);
    expect(health.available).toBe(true);
  });

  it("healthCheck reports auth_required when signed out (no crash)", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    const health = await puterProvider.healthCheck();
    expect(health.status).toBe("auth_required");
    expect(health.authenticated).toBe(false);
  });

  it("generateImage returns the unified response format", async () => {
    const result = await puterProvider.generateImage({
      prompt: "a cat",
      enhancePrompt: false,
      aspectRatio: "1:1",
      quality: "high",
    });
    expect(result.provider).toBe("Puter");
    expect(result.model).toBe("openai/gpt-image-2");
    expect(result.cost).toBe(0);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].startsWith("data:image")).toBe(true);
    expect(result.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(result.generationTime).toBeGreaterThanOrEqual(0);
    expect(mockAi.txt2img).toHaveBeenCalledOnce();
  });

  it("generateImage throws AUTH_REQUIRED when not signed in", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    await expect(
      puterProvider.generateImage({ prompt: "a cat", enhancePrompt: false }),
    ).rejects.toBeInstanceOf(PuterProviderError);
  });

  it("generateImage maps count to multiple images", async () => {
    const result = await puterProvider.generateImage({
      prompt: "a dog",
      enhancePrompt: false,
      count: 2,
    });
    expect(result.images).toHaveLength(2);
    expect(mockAi.txt2img).toHaveBeenCalledTimes(2);
  });
});
