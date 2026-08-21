import { describe, expect, it } from "vitest";
import {
  createLordError,
  parseLordError,
  formatUserFacingError,
  isRecoverable,
  lordErrorResponse,
  type LordError,
} from "./lord-error";

describe("lord-error", () => {
  const sample: LordError = {
    success: false,
    code: "AI_TIMEOUT",
    provider: "gemini",
    model: "gemini-3.5-flash",
    message: "Provider client timeout: The operation was timed out",
    recoverable: true,
    requestId: "7a91f2c0-1234-4abc-8def-0123456789ab",
  };

  it("createLordError fills defaults", () => {
    const err = createLordError({
      code: "AI_UPSTREAM_ERROR",
      message: "boom",
      recoverable: true,
      requestId: "r1",
    });
    expect(err.success).toBe(false);
    expect(err.provider).toBe("unknown");
    expect(err.model).toBe("unknown");
  });

  it("parseLordError handles a plain object", () => {
    expect(parseLordError(sample)).toEqual(sample);
  });

  it("parseLordError handles a JSON string", () => {
    expect(parseLordError(JSON.stringify(sample))).toEqual(sample);
  });

  it("parseLordError handles the legacy { error: {...} } envelope", () => {
    const parsed = parseLordError({
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "AI is not configured.",
        requestId: "r2",
      },
    });
    expect(parsed?.code).toBe("AI_NOT_CONFIGURED");
    expect(parsed?.requestId).toBe("r2");
  });

  it("parseLordError rejects plain text and unknown shapes", () => {
    expect(parseLordError("just a string")).toBeNull();
    expect(parseLordError({ foo: 1 })).toBeNull();
    expect(parseLordError(null)).toBeNull();
  });

  it("formatUserFacingError includes a short request id", () => {
    const text = formatUserFacingError(sample);
    expect(text).toContain("Gemini timed out.");
    expect(text).toContain("7A91F2C0");
    expect(text).toContain("retry");
  });

  it("formatUserFacingError distinguishes rate limits", () => {
    const text = formatUserFacingError(
      createLordError({
        code: "AI_RATE_LIMITED",
        message: "rate limited",
        recoverable: true,
        requestId: "abc",
      }),
    );
    expect(text).toContain("rate limiting");
  });

  it("isRecoverable reflects the flag", () => {
    expect(isRecoverable(sample)).toBe(true);
    expect(isRecoverable({ ...sample, recoverable: false, code: "AI_AUTH_ERROR" })).toBe(false);
  });

  it("lordErrorResponse sets the right body and headers", async () => {
    const res = lordErrorResponse(502, sample);
    expect(res.status).toBe(502);
    expect(res.headers.get("X-LordAI-Request-Id")).toBe(sample.requestId);
    expect(res.headers.get("X-LordAI-Error-Code")).toBe("AI_TIMEOUT");
    const body = (await res.json()) as LordError;
    expect(body.code).toBe("AI_TIMEOUT");
    expect(body.success).toBe(false);
  });
});
