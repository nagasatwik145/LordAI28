// Tests for the client-side image gateway fallback chain:
//   Puter → Cloudflare → OpenRouter
//
// Puter SDK and the network (authenticatedFetch) are mocked so we can verify
// ordering, health-aware skipping, fallback, and the unified response format.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAuth = {
  signIn: vi.fn(async () => ({})),
  signOut: vi.fn(async () => {}),
  isSignedIn: vi.fn(async () => true),
};
const mockAi = {
  txt2img: vi.fn(
    async () => ({ src: "data:image/png;base64,PUTER" }) as unknown as HTMLImageElement,
  ),
};

vi.mock("@heyputer/puter.js", () => ({
  puter: { auth: mockAuth, ai: mockAi },
  default: { auth: mockAuth, ai: mockAi },
}));

vi.mock("@/lib/authenticated-fetch", () => ({
  authenticatedFetch: async (input: RequestInfo | URL, init: RequestInit = {}) =>
    fetch(input, init),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchMock = vi.fn() as any;
vi.stubGlobal("fetch", fetchMock);

// Minimal DOM so the monitoring service + (mocked) SDK run under Node.
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

const { generateImageWithGateway, ImageGatewayError, puterProvider } =
  await import("./image-gateway-client");

function serverResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      imageUrl: "https://example.com/img.png",
      images: ["https://example.com/img.png"],
      model: "x-ai/grok-imagine-image-2.0",
      provider: "OpenRouter",
      generationTime: 123,
      estimatedCost: 0.04,
      ...overrides,
    }),
  };
}

describe("generateImageWithGateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.isSignedIn.mockResolvedValue(true);
    fetchMock.mockReset();
  });

  it("uses Puter first when authenticated (no server call)", async () => {
    const result = await generateImageWithGateway({ prompt: "a cat", provider: "auto" });
    expect(result.provider).toBe("Puter");
    expect(result.images[0]).toContain("data:image");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the server when Puter is not authenticated", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    fetchMock.mockResolvedValue(serverResponse());
    const result = await generateImageWithGateway({ prompt: "a cat", provider: "auto" });
    expect(result.provider).toBe("OpenRouter");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back to the server when Puter generation fails (retryable)", async () => {
    mockAi.txt2img.mockRejectedValueOnce(new Error("generation failed, please retry"));
    fetchMock.mockResolvedValue(serverResponse());
    const result = await generateImageWithGateway({ prompt: "a cat", provider: "auto" });
    expect(result.provider).toBe("OpenRouter");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not fall back from a content-blocked server error", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: "CONTENT_BLOCKED", message: "blocked" } }),
    });
    await expect(
      generateImageWithGateway({ prompt: "bad", provider: "openrouter" }),
    ).rejects.toBeInstanceOf(ImageGatewayError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes explicit Puter selection to a clean auth-required error when signed out", async () => {
    mockAuth.isSignedIn.mockResolvedValue(false);
    const err = await generateImageWithGateway({ prompt: "a cat", provider: "puter" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ImageGatewayError);
    expect((err as { authRequired?: boolean }).authRequired).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the OpenRouter server path directly when selected", async () => {
    fetchMock.mockResolvedValue(serverResponse({ provider: "OpenRouter" }));
    const result = await generateImageWithGateway({
      prompt: "a cat",
      provider: "openrouter",
      model: "x-ai/grok-imagine-image-2.0",
    });
    expect(result.provider).toBe("OpenRouter");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
