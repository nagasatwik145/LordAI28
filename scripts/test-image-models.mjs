/**
 * Live image-model smoke test. Bills real generations (one minimal prompt per
 * model) so it is opt-in:
 *
 *   node scripts/test-image-models.mjs
 *
 * For each configured model it sends a catalog-correct payload built from the
 * live `/api/v1/images/models` schema (so the test never hard-codes enums), then
 * classifies the provider response: success gets an image, 402 = "payload valid
 * but account has no credits", 4xx = "payload still rejected". The distinction
 * is what told us the original bug was a malformed payload, not the provider.
 */
import fs from "node:fs";

const key = process.env.OPENROUTER_API_KEY;
if (!key?.trim()) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(1);
}

const RegistryIds = [];
for (const line of fs
  .readFileSync(new URL("../src/lib/lord-config.ts", import.meta.url), "utf8")
  .split("\n")) {
  const m = line.match(/id:\s*"([^"]+)",/);
  if (m && m[1].includes("/")) RegistryIds.push(m[1]);
}

const catalogRes = await fetch("https://openrouter.ai/api/v1/images/models", {
  headers: { Authorization: `Bearer ${key}` },
  signal: AbortSignal.timeout(20_000),
});
const catalogBody = await catalogRes.json();
const catalog = new Map((catalogBody.data ?? []).map((m) => [m.id, m]));

function nearestEnum(value, options) {
  const [a, b] = value.split(":").map(Number);
  const target = a / b;
  let best = options[0];
  let bestDist = Infinity;
  for (const o of options) {
    const [x, y] = o.split(":").map(Number);
    const d = Math.abs(Math.log(target / (x / y)));
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}
function clampTier(mp, options) {
  const nums = options
    .map((o) => ({ o, n: o === "1K" ? 1 : o === "2K" ? 2 : o === "4K" ? 4 : NaN }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);
  if (!nums.length) return undefined;
  return (
    (mp >= 1024 * 1024 * 1.25 ? nums.find((x) => x.n >= 2) : nums.find((x) => x.n >= 1))?.o ??
    nums.at(-1).o
  );
}

function buildPayload(modelId) {
  const remote = catalog.get(modelId);
  if (!remote) return { model: modelId, prompt: "A red apple on a white table" };
  const p = remote.supported_parameters ?? {};
  const out = { model: modelId, prompt: "A red apple on a white table" };
  const ar = p.aspect_ratio?.values;
  if (ar) out.aspect_ratio = nearestEnum("1:1", ar);
  const res = p.resolution?.values;
  if (res) out.resolution = clampTier(1_000_000, res);
  const q = p.quality?.values;
  if (q && q.includes("medium")) out.quality = "medium";
  else if (q && q.length) out.quality = q[0];
  return out;
}

let allOk = true;
for (const modelId of RegistryIds) {
  const payload = buildPayload(modelId);
  const started = performance.now();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });
    const body = await response.json().catch(() => ({}));
    const received = Boolean(body?.data?.[0]?.url || body?.data?.[0]?.b64_json);
    const reason =
      typeof body?.error === "string" ? body.error : (body?.error?.message ?? body?.message);
    let verdict;
    if (response.ok && received) verdict = "OK (image returned)";
    else if (response.status === 402)
      verdict = "PAYLOAD VALID but 402 (no credits) — would generate with credits";
    else verdict = `REJECTED (${response.status})`;
    if (response.status !== 402 && !received) allOk = false;
    console.log(
      JSON.stringify({
        model: modelId,
        sent: payload,
        status: response.status,
        imageReceived: received,
        verdict,
        reason: reason ?? null,
        latencyMs: Math.round(performance.now() - started),
      }),
    );
  } catch (error) {
    allOk = false;
    console.log(
      JSON.stringify({
        model: modelId,
        status: 0,
        imageReceived: false,
        verdict: "NETWORK ERROR",
        reason: error instanceof Error ? error.message : "Network error",
        latencyMs: Math.round(performance.now() - started),
      }),
    );
  }
}
console.log(
  allOk
    ? "\nRESULT: all models accepted the catalog-correct payload."
    : "\nRESULT: some models still rejected the payload — investigate.",
);
process.exit(allOk ? 0 : 1);
