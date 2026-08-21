import { describe, it, expect } from "vitest";

// TEMPORARY live verification. Requires real CLOUDFLARE_* env. Skipped otherwise.
const hasCreds = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN);

const { cloudflareImageProvider } = await import("../ai/image/cloudflare-provider");

describe("CloudflareImageProvider (LIVE)", () => {
  it.skipIf(!hasCreds)(
    "generates via multipart FLUX.2 (root-cause fix) and parses real bytes",
    async () => {
      const result = await cloudflareImageProvider.generate({
        requestId: "live-1",
        model: process.env.CLOUDFLARE_IMAGE_MODEL ?? "@cf/black-forest-labs/flux-2-klein-9b",
        prompt: "a small red cube on a white table, product photography",
        width: 1024,
        height: 1024,
        aspectRatio: "1:1",
        quality: "balanced",
        count: 1,
      });
      expect(result.provider).toBe("cloudflare");
      expect(result.images).toHaveLength(1);
      const img = result.images[0];
      expect(img.startsWith("data:image/")).toBe(true);
      const b64 = img.split(",")[1] ?? "";
      expect(b64.length).toBeGreaterThan(2000);
      expect(img).toMatch(/^data:image\/(png|jpeg);base64,/);
      console.log("LIVE OK", result.model, img.slice(0, 30), "len", b64.length);
    },
    180_000,
  );

  it.skipIf(!hasCreds)(
    "verifies a JSON model (flux-1-schnell) works too",
    async () => {
      const result = await cloudflareImageProvider.generate({
        requestId: "live-2",
        model: "@cf/black-forest-labs/flux-1-schnell",
        prompt: "a blue sphere",
        width: 1024,
        height: 1024,
        aspectRatio: "1:1",
        quality: "balanced",
        count: 1,
      });
      expect(result.images[0].startsWith("data:image/")).toBe(true);
      console.log("LIVE OK (json)", result.model);
    },
    180_000,
  );
});
