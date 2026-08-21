import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";
import { apiErrorResponse } from "@/lib/api-error";

// Generic, registry-driven tool endpoint. Every Command Center module calls
// this with a registered tool name + params. This is the single integration
// surface between the frontend and the backend tool registry.
export const Route = createFileRoute("/api/lord/tool")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        try {
          const body = (await request.json().catch(() => ({}))) as {
            tool?: string;
            params?: Record<string, unknown>;
          };
          if (!body.tool) {
            return apiErrorResponse(400, "INVALID_ACTION", "Missing 'tool' name.", requestId);
          }
          const userId = (context as { userId?: string }).userId;
          const result = await callTool(body.tool, body.params ?? {}, userId);
          return Response.json(result, { headers: { "Cache-Control": "no-store" } });
        } catch (err) {
          return apiErrorResponse(
            500,
            "INTERNAL_ERROR",
            err instanceof Error ? err.message : "Tool call failed",
            requestId,
          );
        }
      },
    },
  },
});
