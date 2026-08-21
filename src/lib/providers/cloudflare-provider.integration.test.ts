// Integration test for the Cloudflare Workers AI image provider.
//
// Hits the real Cloudflare Workers AI REST API. It is **skipped automatically**
// when CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not configured, so the
// default `npm test` run never makes a network call or needs credentials.
//
// Run it for real with:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npx vitest run cloudflare-provider.integration

import { describe, it, expect, vi } from "vitest";

const hasCredentials = Boolean(
  process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
);

// Surface a clear, locally-runnable note when the integration test is skipped.
if (!hasCredentials) {
  console.info(
    "[cloudflare integration] skipped — set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to run.",
  );
}

const { cloudflareProvider } = await import("./cloudflare-provider");

describe("CloudflareImageProvider (live API)", () => {
  it.skipIf(!hasCredentials)(
    "generates a valid image for 'A futuristic cyberpunk city at sunset'",
    async () => {
      const result = await cloudflareProvider.generateImage({
        prompt: "A futuristic cyberpunk city at sunset",
      });

      expect(result.provider).toBe("Cloudflare");
      expect(result.model).toBeTruthy();
      expect(result.images).toHaveLength(1);

      const image = result.images[0];
      // The provider normalizes every response into a data: URL we can store.
      expect(image.startsWith("data:image/")).toBe(true);

      // A real generated image is a non-trivial base64 payload (>= ~1KB).
      const base64 = image.split(",")[1] ?? "";
      expect(base64.length).toBeGreaterThan(1000);

      // It must decode to actual image bytes, not an error page.
      const decoded = Buffer.from(base64, "base64");
      expect(decoded.byteLength).toBeGreaterThan(1000);
    },
    180_000,
  );
});
