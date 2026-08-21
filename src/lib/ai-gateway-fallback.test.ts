import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider";

import {
  createLordGateway,
  findFirstWorkingModel,
  resetCircuitBreakers,
  AllProvidersFailedError,
  type LordProvidersState,
} from "./ai-gateway.server";
import { OpenRouterClientError, type Candidate, type ProviderName } from "./lord-config";

// Provider errors as the real providers actually report them.
const GEMINI_INVALID_KEY_BODY = JSON.stringify({
  error: {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
    details: [{ reason: "API_KEY_INVALID" }],
  },
});

const OPENAI_INVALID_KEY_BODY = JSON.stringify({
  error: {
    message: "Incorrect API key provided: sk-0e3c1*****. You can find your API key at ...",
    type: "invalid_request_error",
    code: "invalid_api_key",
  },
});

const OPENROUTER_RATE_LIMIT_BODY = JSON.stringify({
  error: { message: "Provider returned error", code: 429 },
});

function authError(status: number, body: string) {
  return new OpenRouterClientError(`provider responded with ${status}`, {
    kind: "api",
    status,
    body,
  });
}

/**
 * Build a gateway whose models behave per provider:
 *   - "ok"        -> answers normally
 *   - an Error    -> thrown on every call (as the AI SDK would surface it)
 * Every model call is recorded so a test can assert exactly which providers
 * were attempted, in order.
 */
function makeHarness(behaviour: Partial<Record<ProviderName, "ok" | Error>>) {
  const calls: Array<{ provider: ProviderName; modelId: string }> = [];

  const state: LordProvidersState = {
    providers: {
      gemini: {} as never,
      openrouter: {} as never,
      openai: {} as never,
      cloudflare: null,
    },
    meta: {
      gemini: { timeoutMs: 5_000, hasKey: true },
      openrouter: { timeoutMs: 5_000, hasKey: true },
      openai: { timeoutMs: 5_000, hasKey: true },
      cloudflare: { timeoutMs: 5_000, hasKey: false },
    },
  };

  const gateway = (candidate: Candidate) => {
    calls.push({ provider: candidate.provider, modelId: candidate.modelId });
    const outcome = behaviour[candidate.provider] ?? "ok";
    if (outcome !== "ok") {
      return new MockLanguageModelV3({
        doGenerate: async () => {
          throw outcome;
        },
        doStream: async () => {
          throw outcome;
        },
      });
    }
    return new MockLanguageModelV3({
      doGenerate: async () =>
        ({
          content: [{ type: "text", text: "OK" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        }) as unknown as LanguageModelV3GenerateResult,
    });
  };

  return { state, gateway, calls };
}

const baseOpts = {
  system: "test",
  messages: [{ role: "user" as const, content: "hello" }],
  requestId: "test-request",
};

const attemptedProviders = (calls: Array<{ provider: ProviderName }>) => [
  ...new Set(calls.map((c) => c.provider)),
];

describe("provider fallback and authentication handling", () => {
  beforeEach(() => {
    // Health cache / circuit breaker / probe cache must not leak between tests.
    resetCircuitBreakers();
  });

  it("falls back to OpenAI and OpenRouter when the Gemini key is rejected with 400 API_KEY_INVALID", async () => {
    const { state, gateway, calls } = makeHarness({
      gemini: authError(400, GEMINI_INVALID_KEY_BODY),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: "ok",
    });

    const result = await findFirstWorkingModel({
      ...baseOpts,
      gateway,
      state,
      mode: "balanced",
    });

    expect(result.provider).toBe("openrouter");
    expect(attemptedProviders(calls)).toEqual(["gemini", "openai", "openrouter"]);

    // Gemini authentication failed, so no second Gemini model may be probed
    // with the same rejected key during this request.
    expect(calls.filter((c) => c.provider === "gemini")).toHaveLength(1);
    const geminiAttempt = result.attempts.find((a) => a.model.startsWith("gemini"));
    expect(geminiAttempt?.reason).toBe("Invalid API key");
    expect(geminiAttempt?.status).toBe(400);
  });

  it("continues to OpenRouter when OpenAI rejects the key with 401", async () => {
    const { state, gateway, calls } = makeHarness({
      gemini: authError(400, GEMINI_INVALID_KEY_BODY),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: "ok",
    });

    const result = await findFirstWorkingModel({
      ...baseOpts,
      gateway,
      state,
      // "reasoning" puts OpenAI first, so this exercises the OpenAI -> OpenRouter hop.
      mode: "reasoning",
    });

    expect(result.provider).toBe("openrouter");
    expect(calls[0].provider).toBe("openai");
    expect(calls.filter((c) => c.provider === "openai")).toHaveLength(1);
    expect(attemptedProviders(calls)).toContain("openrouter");
  });

  it("returns a successful OpenRouter response when only OpenRouter has a working key", async () => {
    const { state, gateway } = makeHarness({
      gemini: authError(403, GEMINI_INVALID_KEY_BODY),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: "ok",
    });

    for (const mode of ["fast", "balanced", "coding", "creative", "reasoning", "local"] as const) {
      resetCircuitBreakers();
      const result = await findFirstWorkingModel({ ...baseOpts, gateway, state, mode });
      expect(result.provider).toBe("openrouter");
    }
  });

  it("only reports exhaustion after every configured provider was attempted", async () => {
    const { state, gateway, calls } = makeHarness({
      gemini: authError(400, GEMINI_INVALID_KEY_BODY),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: authError(429, OPENROUTER_RATE_LIMIT_BODY),
    });

    await expect(
      findFirstWorkingModel({ ...baseOpts, gateway, state, mode: "balanced" }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);

    let error: AllProvidersFailedError | null = null;
    resetCircuitBreakers();
    try {
      await findFirstWorkingModel({ ...baseOpts, gateway, state, mode: "balanced" });
    } catch (err) {
      error = err as AllProvidersFailedError;
    }

    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect(error?.allProvidersAttempted).toBe(true);
    expect(error?.notAttemptedProviders).toEqual([]);
    expect([...(error?.attemptedProviders ?? [])].sort()).toEqual([
      "gemini",
      "openai",
      "openrouter",
    ]);
    expect(attemptedProviders(calls)).toContain("openrouter");
    // Retryable failures (429/5xx) back off between probes, so a full sweep of
    // every provider legitimately takes several seconds.
  }, 60_000);

  it("attempts a provider on its other models when one model is unavailable", async () => {
    // Gemini fails with a 404 (model unavailable), which is NOT an auth failure:
    // the provider must keep its remaining model in the plan instead of being
    // dropped from routing entirely.
    const { state, gateway, calls } = makeHarness({
      gemini: authError(404, JSON.stringify({ error: { message: "model not found" } })),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: authError(429, OPENROUTER_RATE_LIMIT_BODY),
    });

    await expect(
      findFirstWorkingModel({ ...baseOpts, gateway, state, mode: "balanced" }),
    ).rejects.toBeInstanceOf(AllProvidersFailedError);

    const geminiModels = new Set(
      calls.filter((c) => c.provider === "gemini").map((c) => c.modelId),
    );
    expect(geminiModels.size).toBeGreaterThan(1);

    // OpenAI's key was rejected, so only one OpenAI model may be contacted.
    const openaiModels = new Set(
      calls.filter((c) => c.provider === "openai").map((c) => c.modelId),
    );
    expect(openaiModels.size).toBe(1);
  }, 60_000);

  it("skips providers without a configured key and reports them as not attempted", async () => {
    const { state, gateway, calls } = makeHarness({
      gemini: authError(400, GEMINI_INVALID_KEY_BODY),
      openai: authError(401, OPENAI_INVALID_KEY_BODY),
      openrouter: authError(429, OPENROUTER_RATE_LIMIT_BODY),
    });
    state.meta.openrouter.hasKey = false;

    let error: AllProvidersFailedError | null = null;
    try {
      await findFirstWorkingModel({ ...baseOpts, gateway, state, mode: "balanced" });
    } catch (err) {
      error = err as AllProvidersFailedError;
    }

    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect(error?.configuredProviders).not.toContain("openrouter");
    expect(calls.some((c) => c.provider === "openrouter")).toBe(false);
    // Gemini and OpenAI were configured and both were contacted.
    expect(error?.allProvidersAttempted).toBe(true);
  }, 60_000);
});
