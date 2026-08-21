/** Billable smoke test for every configured OpenRouter image model. */
const models = [
  "x-ai/grok-imagine-image-2.0",
  "google/gemini-3.1-flash-lite-image",
  "black-forest-labs/flux.2-max",
  "qwen/qwen-image-3-pro",
];
const key = process.env.OPENROUTER_API_KEY;
if (!key?.trim()) throw new Error("Missing OPENROUTER_API_KEY");

for (const model of models) {
  const started = performance.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "A man standing in the hot sun", n: 1 }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json();
    const reason =
      typeof payload.error === "string"
        ? payload.error
        : (payload.error?.message ?? payload.message);
    console.log(
      JSON.stringify({
        model,
        success: response.ok && Boolean(payload.data?.[0]?.url || payload.data?.[0]?.b64_json),
        status: response.status,
        latencyMs: Math.round(performance.now() - started),
        imageReceived: Boolean(payload.data?.[0]?.url || payload.data?.[0]?.b64_json),
        fallbackUsed: false,
        reason: reason ?? null,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        model,
        success: false,
        latencyMs: Math.round(performance.now() - started),
        imageReceived: false,
        fallbackUsed: false,
        reason: error instanceof Error ? error.message : "Network error",
      }),
    );
  }
}
