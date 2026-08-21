// Unit tests for the Cloudflare image provider — every failure path (spec §13)
// is exercised with a mocked `fetch` so no real network call is made.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { CloudflareImageProvider } from "./cloudflare-provider";
import { ImageGenerationError } from "./image-errors";
import { getConfiguredModelError, getImageEnvironmentError } from "./image-validation";
import type { StructuredLogger } from "../shared/structured-logger";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binaryResponse(bytes: number[]): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

function fakeProvider(
  fetchImpl: typeof fetch,
  overrides: { timeoutMs?: number; maxRetries?: number } = {},
) {
  return new CloudflareImageProvider({
    fetchImpl,
    timeoutMs: overrides.timeoutMs ?? 5000,
    maxRetries: overrides.maxRetries ?? 0,
  });
}

function captureLogger(logs: unknown[][]): StructuredLogger {
  const make = (): StructuredLogger => ({
    debug: (...a: unknown[]) => logs.push(a),
    info: (...a: unknown[]) => logs.push(a),
    warn: (...a: unknown[]) => logs.push(a),
    error: (...a: unknown[]) => logs.push(a),
    child: () => make(),
  });
  return make();
}

const baseRequest = {
  requestId: "test-1",
  model: "@cf/black-forest-labs/flux-2-klein-9b",
  prompt: "a cat",
  width: 1024,
  height: 1024,
  aspectRatio: "1:1",
  quality: "balanced" as const,
  count: 1,
};

beforeEach(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
});

afterEach(() => {
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_IMAGE_MODEL;
});

describe("CloudflareImageProvider failure paths", () => {
  it("rejects an invalid API token (401) as INVALID_CREDENTIALS", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { errors: [{ message: "Invalid API token" }] }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      recoverable: false,
    });
  });

  it("rejects an invalid account id (403) as INVALID_CREDENTIALS", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(403, { errors: [{ message: "account not found" }] }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects an unknown model (404) as INVALID_MODEL", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(404, { errors: [{ message: "model not found" }] }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "INVALID_MODEL",
      recoverable: false,
    });
  });

  it("treats rate limiting (429) as recoverable RATE_LIMITED", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { errors: [{ message: "rate limited" }] }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      recoverable: true,
    });
  });

  it("treats a server error (500) as recoverable PROVIDER_ERROR", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, { errors: [{ message: "boom" }] }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      recoverable: true,
    });
  });

  it("classifies an aborted fetch as TIMEOUT", async () => {
    const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const fetchImpl = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "TIMEOUT",
      recoverable: true,
    });
  });

  it("throws MALFORMED_RESPONSE on a 200 with no result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { result: {} }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("blocks content-policy violations (400) as CONTENT_BLOCKED", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, {
        errors: [{ message: "Content policy violation: prompt is not allowed" }],
      }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toMatchObject({
      code: "CONTENT_BLOCKED",
      recoverable: false,
    });
  });

  it("parses a binary image response into a data URL (spec §10)", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer test-token");
      return binaryResponse([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    const result = await provider.generate(baseRequest);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatch(/^data:image\/png;base64,/);
  });

  it("parses a JSON image response (result.image) into a data URL", async () => {
    const b64 = Buffer.from("fake-png-bytes").toString("base64");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { result: { image: b64 } }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    const result = await provider.generate(baseRequest);
    expect(result.images[0]).toBe(`data:image/png;base64,${b64}`);
  });

  it("parses result.images[] and result.data[] payloads", async () => {
    const b64 = Buffer.from("abc").toString("base64");
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { result: { images: [b64], data: [{ b64_json: b64 }] } }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    const result = await provider.generate(baseRequest);
    expect(result.images).toContain(`data:image/png;base64,${b64}`);
  });

  it("reports missing credentials before any network call", async () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { result: { image: "x" } }),
    ) as unknown as typeof fetch;
    const provider = fakeProvider(fetchImpl);
    await expect(provider.generate(baseRequest)).rejects.toBeInstanceOf(ImageGenerationError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never logs the API token in request headers", async () => {
    const logs: unknown[][] = [];
    const fetchImpl = vi.fn(async () => binaryResponse([1, 2, 3])) as unknown as typeof fetch;
    const provider = new CloudflareImageProvider({
      fetchImpl,
      maxRetries: 0,
      logger: captureLogger(logs),
    });
    await provider.generate(baseRequest);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("test-token");
    expect(serialized).toContain("<redacted>");
  });
});

describe("image environment + configured-model validation (spec §5, §6)", () => {
  it("flags missing credentials", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    const err = getImageEnvironmentError();
    expect(err).not.toBeNull();
    expect(err?.code).toBe("MISSING_CREDENTIALS");
    expect(err?.message).toBe("Cloudflare configuration missing.");
    expect(err?.recoverable).toBe(false);
  });

  it("accepts a valid environment", () => {
    expect(getImageEnvironmentError()).toBeNull();
  });

  it("rejects an invalid configured model id", () => {
    process.env.CLOUDFLARE_IMAGE_MODEL = "not-a-real-model";
    const err = getConfiguredModelError();
    expect(err?.code).toBe("INVALID_MODEL");
    expect(err?.message).toContain("Configured model does not exist.");
  });

  it("accepts a registered configured model id", () => {
    process.env.CLOUDFLARE_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";
    expect(getConfiguredModelError()).toBeNull();
  });
});
