// Thin wrapper over the existing LORD AI gateway so Command Center tools and the
// Agent Engine get the same provider fallback, health caching, and logging as
// the chat endpoint — without duplicating any of that machinery.

import { generateText } from "ai";
import { createLogger } from "@/lib/gateway-logger";
import { GATEWAY_CONFIG } from "@/lib/gateway-config";
import {
  createLordProviders,
  createLordGateway,
  generateTextWithFallback,
  getConfiguredProviders,
} from "@/lib/ai-gateway.server";
import { PROVIDER_CONFIG } from "@/lib/lord-config";
import type { LordMode, ProviderName, Candidate } from "@/lib/lord-config";

export interface LlmCallOptions {
  system: string;
  prompt: string;
  mode?: LordMode;
  maxTokens?: number;
}

export async function runLordText(
  opts: LlmCallOptions,
): Promise<{ text: string; provider?: string }> {
  const logger = createLogger(GATEWAY_CONFIG);
  const state = createLordProviders(logger);
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error("AI_NOT_CONFIGURED");
  }
  const gateway = createLordGateway(state);
  const { text, provider } = await generateTextWithFallback({
    gateway,
    state,
    mode: opts.mode ?? "reasoning",
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    requestId: crypto.randomUUID(),
    maxOutputTokens: opts.maxTokens ?? 2048,
  });
  return { text, provider };
}

/** Vision-capable completion: send an image (data URL) + a text prompt to a
 *  vision model. Falls back across configured providers, preferring Gemini and
 *  OpenAI (both support multimodal input). */
export async function runLordVision(opts: {
  prompt: string;
  image: string;
  mode?: LordMode;
}): Promise<{ text: string; provider?: string }> {
  const logger = createLogger(GATEWAY_CONFIG);
  const state = createLordProviders(logger);
  const gateway = createLordGateway(state);

  // Order candidates so vision-capable providers are tried first.
  const order: ProviderName[] = ["gemini", "openai", "openrouter"];
  const candidates: Candidate[] = [];
  for (const p of order) {
    if (state.meta[p]?.hasKey) {
      for (const modelId of PROVIDER_CONFIG[p].models) {
        candidates.push({ provider: p, modelId });
      }
    }
  }
  if (candidates.length === 0) throw new Error("AI_NOT_CONFIGURED");

  let lastErr: unknown;
  for (const candidate of candidates) {
    try {
      const { text } = await generateText({
        model: gateway(candidate),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: opts.prompt },
              { type: "image", image: opts.image },
            ],
          },
        ],
        maxOutputTokens: 1500,
      });
      return { text, provider: candidate.provider };
    } catch (err) {
      lastErr = err;
      logger.warn("vision_provider_failed", {
        provider: candidate.provider,
        model: candidate.modelId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Vision analysis failed");
}

/** Ask the LLM for strict JSON and parse it defensively. */
export async function runLordJson<T = unknown>(
  opts: LlmCallOptions & { schemaHint?: string },
): Promise<T> {
  const system = [
    opts.system,
    "You must respond with a single valid JSON object and nothing else.",
    opts.schemaHint ?? "",
  ].join("\n");
  const { text } = await runLordText({ ...opts, system });
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to salvage a JSON object embedded in prose.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("LLM did not return valid JSON");
  }
}
