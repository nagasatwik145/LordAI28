// GET /api/image/health — Cloudflare Workers AI provider health probe.
//
// Returns a compact, operator-friendly summary:
//   { provider, connected, accountConfigured, model, healthy, ... }
// It never exposes secrets (no token, no account id in the body) and degrades
// gracefully: a missing token reports `accountConfigured: false` instead of 500.

import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import {
  IMAGE_PROVIDER_ID,
  IMAGE_PROVIDER_LABEL,
  checkImageHealth,
  resolveConfiguredModelId,
} from "@/lib/ai/image";
import { getImageEnvironmentError } from "@/lib/ai/image/image-validation";

export const Route = createFileRoute("/api/image/health")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async () => {
        const configuredModel = resolveConfiguredModelId(process.env.CLOUDFLARE_IMAGE_MODEL).id;

        const envError = getImageEnvironmentError();
        if (envError) {
          return Response.json(
            {
              provider: IMAGE_PROVIDER_ID,
              providerLabel: IMAGE_PROVIDER_LABEL,
              connected: false,
              accountConfigured: false,
              model: configuredModel,
              healthy: false,
              status: "missing_credentials",
              reason: envError.message,
              code: envError.code,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }

        try {
          const health = await checkImageHealth(true);
          const connected = health.credentialsConfigured && health.status !== "offline";
          return Response.json(
            {
              provider: IMAGE_PROVIDER_ID,
              providerLabel: IMAGE_PROVIDER_LABEL,
              connected,
              accountConfigured: health.credentialsConfigured,
              model: configuredModel,
              healthy: health.healthy,
              status: health.status,
              ...(health.reason ? { reason: health.reason } : {}),
              latencyMs: health.latencyMs,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return Response.json(
            {
              provider: IMAGE_PROVIDER_ID,
              providerLabel: IMAGE_PROVIDER_LABEL,
              connected: false,
              accountConfigured: true,
              model: configuredModel,
              healthy: false,
              status: "unknown",
              reason: error instanceof Error ? error.message : "Health check failed.",
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
