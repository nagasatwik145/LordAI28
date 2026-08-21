import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { runAgent } from "@/lib/lord/api";
import { apiErrorResponse } from "@/lib/api-error";

export const Route = createFileRoute("/api/lord/agent/execute")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        try {
          const body = (await request.json().catch(() => ({}))) as {
            command?: string;
            planId?: string;
            approvedStepIds?: string[] | "all";
          };
          const userId = (context as { userId?: string }).userId;
          const result = await runAgent(body, userId);
          return Response.json(
            { ...result, requestId },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (err) {
          return apiErrorResponse(
            500,
            "INTERNAL_ERROR",
            err instanceof Error ? err.message : "Agent execution failed",
            requestId,
          );
        }
      },
    },
  },
});
