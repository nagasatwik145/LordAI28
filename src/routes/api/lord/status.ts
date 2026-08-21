import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import {
  ensureBooted,
  getConnectionStatus,
  getActivity,
  getToolCatalogSummary,
  isConfigured,
} from "@/lib/lord/index";

export const Route = createFileRoute("/api/lord/status")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async () => {
        ensureBooted();
        return Response.json(
          {
            success: true,
            connections: getConnectionStatus(),
            activity: getActivity(25),
            tools: getToolCatalogSummary(),
            configured: isConfigured(),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
