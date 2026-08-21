// Client-side image logger.
//
// Mirrors the structured style of the server gateway-logger but is safe to run
// in the browser. It deliberately NEVER logs prompts, tokens, image bytes, or
// any user content — only provider/model/timing/retry/fallback/success signals.

import { monitoring } from "./monitoring-service";

type ImageLogEvent =
  | "image_request_started"
  | "image_provider_attempt"
  | "image_provider_success"
  | "image_provider_error"
  | "image_provider_fallback"
  | "image_request_complete"
  | "image_request_failed"
  | "image_auth_required";

function emit(event: ImageLogEvent, payload: Record<string, unknown>) {
  // Structured console output (matches server gateway format) for operators.

  console.info(JSON.stringify({ level: "info", event, ...payload, timestamp: Date.now() }));
  try {
    monitoring.logEvent({
      type: event.includes("error") || event.includes("failed") ? "error" : "info",
      category: "image_generation",
      message: event,
      metadata: payload,
    });
  } catch {
    // Logging must never break image generation.
  }
}

export const imageLogger = {
  requestStarted(requestId: string, providerSelection: string, promptLength: number) {
    emit("image_request_started", { requestId, providerSelection, promptLength });
  },
  providerAttempt(requestId: string, provider: string) {
    emit("image_provider_attempt", { requestId, provider });
  },
  providerSuccess(
    requestId: string,
    provider: string,
    model: string,
    generationTime: number,
    imageCount: number,
    attempt: number,
  ) {
    emit("image_provider_success", {
      requestId,
      provider,
      model,
      generationTime,
      imageCount,
      attempt,
    });
  },
  providerError(requestId: string, provider: string, code: string, retryable: boolean) {
    emit("image_provider_error", { requestId, provider, code, retryable });
  },
  providerFallback(requestId: string, from: string, to: string, reason: string) {
    emit("image_provider_fallback", { requestId, from, to, reason });
  },
  authRequired(requestId: string, provider: string) {
    emit("image_auth_required", { requestId, provider });
  },
  requestComplete(
    requestId: string,
    provider: string,
    generationTime: number,
    fallbackCount: number,
    cost: number,
  ) {
    emit("image_request_complete", {
      requestId,
      provider,
      generationTime,
      fallbackCount,
      cost,
    });
  },
  requestFailed(requestId: string, lastProvider: string, reason: string) {
    emit("image_request_failed", { requestId, lastProvider, reason });
  },
};
