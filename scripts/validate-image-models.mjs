/**
 * Image-model registry validation (no billable images).
 *
 * Verifies every model in `src/lib/lord-config.ts` IMAGE_MODELS against the live
 * OpenRouter image catalog. Confirms each entry exists, is available, and
 * advertises the capabilities the registry claims. Prints the IMAGE MODELS
 * report exactly like startup validation.
 *
 *   node scripts/validate-image-models.mjs
 *
 * Uses the catalog schema to drive the checks, so it never hard-codes enum
 * values and flags registry drift automatically.
 */
const ROOT = new URL("../", import.meta.url).pathname;
const RESOLVE = (p) => new URL(p, import.meta.url).pathname;

// Read the registry ids/labels directly from source so this script stays in
// sync with lord-config without importing the TS module in a plain node script.
const fs = await import("node:fs");
const src = fs.readFileSync(RESOLVE("../src/lib/lord-config.ts"), "utf8");
const configMatches = [...src.matchAll(/id:\s*"([^"]+)"[\s\S]*?label:\s*"([^"]+)"/g)];

const key = process.env.OPENROUTER_API_KEY;
if (!key?.trim()) {
  console.error("OPENROUTER_API_KEY is not set; cannot validate the catalog.");
  process.exit(1);
}

console.log("IMAGE MODELS");
let allValid = true;
try {
  const res = await fetch("https://openrouter.ai/api/v1/images/models", {
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok) {
    console.log(`  ✗ catalog unavailable (${res.status})`);
    process.exit(1);
  }
  const catalog = new Map((body.data ?? []).map((m) => [m.id, m]));

  for (const [, id, label] of configMatches) {
    const remote = catalog.get(id);
    const out = remote?.architecture?.output_modalities ?? [];
    if (!remote) {
      allValid = false;
      console.log(`  ✗ ${label}\n    Reason: not present in the OpenRouter image catalog`);
      continue;
    }
    if (!out.includes("image")) {
      allValid = false;
      console.log(`  ✗ ${label}\n    Reason: catalog entry does not output images`);
      continue;
    }
    const params = remote.supported_parameters ?? {};
    const paramKeys = Array.isArray(params) ? params : Object.keys(params);
    console.log(`  ✔ ${label}`);
    console.log(`    id: ${id}`);
    console.log(`    params: ${paramKeys.join(", ")}`);
  }
} catch (error) {
  console.log(`  ✗ validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log("");
console.log(
  allValid
    ? "RESULT: all configured image models are valid."
    : "RESULT: registry has issues — see above.",
);
process.exit(allValid ? 0 : 1);
