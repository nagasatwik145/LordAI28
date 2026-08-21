import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import {
  IMAGE_MODEL_REGISTRY,
  DEFAULT_IMAGE_MODEL_ID,
  resolveConfiguredModelId,
  getProviderCapabilities,
  toModelDescriptor,
  checkImageHealth,
  IMAGE_PROVIDER_ID,
  IMAGE_PROVIDER_LABEL,
} from "@/lib/ai/image";

export const Route = createFileRoute("/api/images/models")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async () => {
        const health = await checkImageHealth();
        const configuredModel = resolveConfiguredModelId(process.env.CLOUDFLARE_IMAGE_MODEL).id;

        const allModels = IMAGE_MODEL_REGISTRY.map((entry) => {
          const modelHealth = health.models.find((m) => m.model === entry.id);
          return toModelDescriptor(
            entry,
            {
              status: modelHealth?.status ?? "unknown",
              healthy: modelHealth?.healthy ?? false,
              ...(modelHealth?.reason ? { reason: modelHealth.reason } : {}),
            },
            { recommended: entry.id === DEFAULT_IMAGE_MODEL_ID },
          );
        });

        const healthyModels = allModels.filter((m) => m.healthy);

        return Response.json(
          {
            success: true,
            provider: IMAGE_PROVIDER_ID,
            providerLabel: IMAGE_PROVIDER_LABEL,
            defaultModel: configuredModel,
            models: healthyModels,
            allModels,
            health,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

export { getProviderCapabilities };
