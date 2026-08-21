// Unit tests for the Cloudflare Workers AI image provider.
//
// `fetch` is mocked so we can validate the contract (config, unified response
// shape, binary-vs-JSON handling, and meaningful errors) without credentials or
// a network connection.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);

const { cloudflareProvider, CloudflareImageProviderError, CLOUDFLARE_DEFAULT_IMAGE_MODEL } =
  await import("./cloudflare-provider");

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

function binaryResponse(status: number, bytes: Uint8Array, contentType: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? contentType : null) },
    json: async () => {
      throw new Error("not json");
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("CloudflareImageProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_IMAGE_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the default model when CLOUDFLARE_IMAGE_MODEL is not set", () => {
    expect(cloudflareProvider.id).toBe("cloudflare");
  });

  it("returns a data URL from a JSON envelope (result.image)", async () => {
    const base64 = Buffer.from("fake-png-bytes").toString("base64");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { success: true, result: { image: base64 } }),
    );

    const result = await cloudflareProvider.generateImage({ prompt: "a cat" });

    expect(result.provider).toBe("Cloudflare");
    expect(result.model).toBe(CLOUDFLARE_DEFAULT_IMAGE_MODEL);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toBe(`data:image/png;base64,${base64}`);
    expect(result.cost).toBe(0);
    expect(result.requestId).toMatch(/[0-9a-f-]{36}/);
    const [url, init] = fetchMock.mock.calls[0];
    expect(decodeURIComponent(url)).toContain(
      `/accounts/test-account/ai/run/${CLOUDFLARE_DEFAULT_IMAGE_MODEL}`,
    );
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    expect(JSON.parse((init as { body: string }).body)).toEqual({ prompt: "a cat" });
  });

  it("returns a data URL from a raw binary image response", async () => {
    const bytes = new TextEncoder().encode("PNGDATA");
    fetchMock.mockResolvedValueOnce(binaryResponse(200, bytes, "image/png"));

    const result = await cloudflareProvider.generateImage({ prompt: "a dog" });

    expect(result.images[0]).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  });

  it("honors an explicit model from params and config", async () => {
    vi.stubEnv("CLOUDFLARE_IMAGE_MODEL", "@cf/black-forest-labs/flux-1-schnell");
    const base64 = Buffer.from("x").toString("base64");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { success: true, result: { image: base64 } }),
    );

    const result = await cloudflareProvider.generateImage({
      prompt: "a fox",
      model: "@cf/black-forest-labs/flux-dev",
    });

    expect(result.model).toBe("@cf/black-forest-labs/flux-dev");
    expect(decodeURIComponent(fetchMock.mock.calls[0][0])).toContain(
      "/accounts/test-account/ai/run/@cf/black-forest-labs/flux-dev",
    );
  });

  it("throws MISSING_CREDENTIALS when account id or token is absent", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");

    await expect(cloudflareProvider.generateImage({ prompt: "a cat" })).rejects.toBeInstanceOf(
      CloudflareImageProviderError,
    );
    const err = (await cloudflareProvider
      .generateImage({ prompt: "a cat" })
      .catch((e) => e)) as InstanceType<typeof CloudflareImageProviderError>;
    expect(err.code).toBe("MISSING_CREDENTIALS");
  });

  it("throws AUTH_FAILED on a 401 response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { success: false, errors: [{ message: "invalid token" }] }),
    );

    await expect(cloudflareProvider.generateImage({ prompt: "a cat" })).rejects.toMatchObject({
      code: "AUTH_FAILED",
      status: 401,
      retryable: false,
    });
  });

  it("throws RATE_LIMITED on a 429 response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(429, { success: false, errors: [{ message: "rate limited" }] }),
    );

    await expect(cloudflareProvider.generateImage({ prompt: "a cat" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      retryable: true,
    });
  });

  it("throws GENERATION_FAILED with a clean message on a failed JSON envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { success: false, errors: [{ message: "blocked by policy" }] }),
    );

    await expect(cloudflareProvider.generateImage({ prompt: "a cat" })).rejects.toMatchObject({
      code: "GENERATION_FAILED",
    });
  });

  it("healthCheck reports available when credentials are configured", async () => {
    const health = await cloudflareProvider.healthCheck();
    expect(health.status).toBe("available");
    expect(health.authenticated).toBe(true);
    expect(health.available).toBe(true);
  });
});
