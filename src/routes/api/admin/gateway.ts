import { createFileRoute } from "@tanstack/react-router";
import {
  getGatewayInfrastructure,
  getProviderConfigurationDiagnostics,
  logProviderConfigurationDiagnostics,
  resetGatewayInfrastructure,
} from "@/lib/ai-gateway.server";
import { GATEWAY_CONFIG } from "@/lib/gateway-config";
import { createLogger } from "@/lib/gateway-logger";
import { PROVIDER_CONFIG } from "@/lib/lord-config";
import { MODEL_REGISTRY } from "@/lib/model-registry";
import { checkImageHealth } from "@/lib/ai/image";
import { reloadServerEnv } from "@/lib/env.server";

const logger = createLogger(GATEWAY_CONFIG);

export const Route = createFileRoute("/api/admin/gateway")({
  server: {
    handlers: {
      GET: async () => {
        const infra = getGatewayInfrastructure(logger);
        const providers = ["gemini", "openrouter", "openai"] as const;
        const providerHealth: Record<
          string,
          { status: string; models: Array<{ model: string; status: string; reason?: string }> }
        > = {};

        for (const provider of providers) {
          const models = PROVIDER_CONFIG[provider].models;
          const modelEntries = models.map((modelId) => {
            const health = infra.healthCache.get(provider, modelId);
            const circuit = infra.circuitBreaker.getState(provider, modelId);
            const stats = infra.modelStats.getStats(provider, modelId);
            return {
              model: modelId,
              status: health?.status ?? "healthy",
              reason: health?.reason,
              circuit: circuit.state,
              failureCount: circuit.failureCount,
              requests: stats.requests,
              successes: stats.successes,
              failures: stats.failures,
              avgTTFTMs:
                stats.successes > 0 ? Math.round(stats.totalTTFTMs / stats.successes) : null,
            };
          });

          const hasUnhealthy = modelEntries.some(
            (m) => m.status !== "healthy" || m.circuit !== "closed",
          );
          providerHealth[provider] = {
            status: hasUnhealthy ? "degraded" : "healthy",
            models: modelEntries,
          };
        }

        const disabledModels = infra.healthCache.getDisabledModels();
        const circuitBreakers = infra.circuitBreaker.getAll();
        const allStats = infra.modelStats.getAllStats();

        const providerDiagnostics = getProviderConfigurationDiagnostics();
        const imageProvider = await checkImageHealth();

        return Response.json({
          timestamp: Date.now(),
          providerConfiguration: providerDiagnostics,
          providers: providerHealth,
          imageProvider,
          disabledModels: disabledModels.map((m) => ({
            provider: m.provider,
            model: m.model,
            status: m.status,
            reason: m.reason,
            expiresAt: m.expiresAt,
          })),
          circuitBreakers: circuitBreakers.map((c) => ({
            provider: c.provider,
            model: c.model,
            state: c.state,
            failureCount: c.failureCount,
            openedAt: c.openedAt,
          })),
          modelStats: allStats.map((s) => ({
            provider: s.provider,
            model: s.model,
            requests: s.requests,
            successes: s.successes,
            failures: s.failures,
            failureRate: s.requests > 0 ? Math.round((s.failures / s.requests) * 100) : 0,
            avgTTFTMs: s.successes > 0 ? Math.round(s.totalTTFTMs / s.successes) : null,
          })),
          registry: MODEL_REGISTRY.map((m) => ({ id: m.id, label: m.label, provider: m.provider })),
        });
      },
      POST: async ({ request }) => {
        const action =
          (request.headers.get("content-type")?.includes("application/json")
            ? (await request.json().catch(() => ({})))?.action
            : new URL(request.url).searchParams.get("action")) ?? "reset";

        if (action === "reload-env") {
          reloadServerEnv();
          const diagnostics = logProviderConfigurationDiagnostics(logger);
          return Response.json({
            ok: true,
            message: "Server environment reloaded from .env",
            providerConfiguration: diagnostics,
          });
        }

        if (action === "reset") {
          resetGatewayInfrastructure();
          return Response.json({ ok: true, message: "Gateway state reset" });
        }

        return Response.json({ ok: false, message: `Unknown action: ${action}` }, { status: 400 });
      },
    },
  },
});
