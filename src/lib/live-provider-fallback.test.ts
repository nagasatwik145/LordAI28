/**
 * LIVE provider-fallback verification.
 *
 * These checks talk to the real Gemini / OpenAI / OpenRouter endpoints, so they
 * are opt-in and skipped by default:
 *
 *   LORD_LIVE_PROVIDER_TESTS=1 npx vitest run src/lib/live-provider-fallback.test.ts
 *
 * They verify the three runbook scenarios end to end:
 *   1. invalid Gemini key   -> OpenAI / OpenRouter are attempted
 *   2. invalid OpenAI key   -> OpenRouter is attempted
 *   3. valid OpenRouter key -> successful response
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  AllProvidersFailedError,
  createLordGateway,
  createLordProviders,
  findFirstWorkingModel,
  getConfiguredProviders,
  logProviderConfigurationDiagnostics,
  resetCircuitBreakers,
} from "./ai-gateway.server";
import { loadServerEnv } from "./env.server";
import { GATEWAY_CONFIG } from "./gateway-config";
import { createLogger } from "./gateway-logger";
import type { LordMode } from "./lord-config";

const LIVE = !!process.env.LORD_LIVE_PROVIDER_TESTS;

// Well-formed but deliberately wrong keys: the provider must reject them with
// its authentication error (Gemini 400 API_KEY_INVALID, OpenAI 401).
const INVALID_GEMINI_KEY = "AIzaSyINVALIDINVALIDINVALIDINVALIDINVALID";
const INVALID_OPENAI_KEY = "sk-proj-INVALIDINVALIDINVALIDINVALIDINVALIDINVALID";

const logger = createLogger(GATEWAY_CONFIG);

function probe(mode: LordMode, explicitModelId?: string) {
  const state = createLordProviders(logger);
  const gateway = createLordGateway(state);
  return findFirstWorkingModel({
    gateway,
    state,
    mode,
    explicitModelId,
    system: "Reply with OK",
    messages: [{ role: "user", content: "Say OK" }],
    requestId: `live-${mode}-${Date.now()}`,
  });
}

function summarize(label: string, result: Awaited<ReturnType<typeof probe>>) {
  console.info(
    `${label}: served by ${result.provider}/${result.candidate.modelId}; attempts=` +
      JSON.stringify(result.attempts.map((a) => `${a.model} -> ${a.status} ${a.reason}`)),
  );
}

/**
 * Run a probe and report either the winning provider or the exhaustion details.
 * Upstream capacity (OpenAI quota, OpenRouter's shared free pool) is outside our
 * control, so these checks assert on fallback BEHAVIOUR: which providers were
 * contacted and how their errors were classified.
 */
async function probeOutcome(mode: LordMode, label: string, explicitModelId?: string) {
  try {
    const result = await probe(mode, explicitModelId);
    summarize(label, result);
    return {
      served: result.provider as string | null,
      attempts: result.attempts,
      attemptedProviders: null as string[] | null,
      allProvidersAttempted: true,
    };
  } catch (err) {
    if (!(err instanceof AllProvidersFailedError)) throw err;
    console.info(
      `${label}: no provider could serve; attempted=${err.attemptedProviders.join(", ")}; attempts=` +
        JSON.stringify(err.lordAttempts.map((a) => `${a.model} -> ${a.status} ${a.reason}`)),
    );
    return {
      served: null,
      attempts: err.lordAttempts,
      attemptedProviders: err.attemptedProviders as string[],
      allProvidersAttempted: err.allProvidersAttempted,
    };
  }
}

describe.skipIf(!LIVE)("LIVE provider fallback", () => {
  beforeEach(() => {
    loadServerEnv({ force: true });
    resetCircuitBreakers();
  });

  it("logs which providers are configured", () => {
    const diagnostics = logProviderConfigurationDiagnostics(logger);
    console.info("configured providers:", getConfiguredProviders().join(", ") || "none");
    expect(diagnostics).toHaveLength(3);
  });

  it("invalid Gemini key -> OpenAI/OpenRouter attempted", async () => {
    process.env.GEMINI_API_KEY = INVALID_GEMINI_KEY;

    const outcome = await probeOutcome("balanced", "invalid Gemini key");

    // Gemini's rejection is recognised as an authentication failure...
    const geminiAttempt = outcome.attempts.find((a) => a.model.startsWith("gemini"));
    expect(geminiAttempt?.reason).toBe("Invalid API key");
    // ...Gemini never serves the request...
    expect(outcome.served).not.toBe("gemini");
    // ...and the other providers are genuinely contacted.
    const otherProviderAttempts = outcome.attempts.filter((a) => !a.model.startsWith("gemini"));
    expect(otherProviderAttempts.length).toBeGreaterThan(0);
    expect(outcome.allProvidersAttempted).toBe(true);
  }, 180_000);

  it("invalid OpenAI key -> OpenRouter attempted", async () => {
    process.env.GEMINI_API_KEY = INVALID_GEMINI_KEY;
    process.env.OPENAI_API_KEY = INVALID_OPENAI_KEY;

    const outcome = await probeOutcome("balanced", "invalid Gemini + OpenAI keys");

    const openaiAttempt = outcome.attempts.find((a) => a.model.startsWith("gpt-"));
    expect(openaiAttempt?.reason).toBe("Invalid API key");
    // OpenRouter is reached automatically after the OpenAI auth failure.
    const openRouterAttempted =
      outcome.served === "openrouter" || outcome.attempts.some((a) => a.model.includes("/"));
    expect(openRouterAttempted).toBe(true);
    expect(outcome.allProvidersAttempted).toBe(true);
  }, 180_000);

  it("valid OpenRouter key -> successful response", async () => {
    process.env.GEMINI_API_KEY = INVALID_GEMINI_KEY;
    process.env.OPENAI_API_KEY = INVALID_OPENAI_KEY;

    // An explicit OpenRouter model keeps this check independent of the shared
    // free-tier pool, which is frequently rate-limited upstream.
    const result = await probe("balanced", "google/gemini-2.5-flash-lite");
    summarize("valid OpenRouter key", result);

    expect(result.provider).toBe("openrouter");
  }, 180_000);

  it("all configured keys -> a provider serves the request", async () => {
    const result = await probe("balanced");
    summarize("all real keys", result);
    expect(["gemini", "openai", "openrouter"]).toContain(result.provider);
  }, 180_000);
});
