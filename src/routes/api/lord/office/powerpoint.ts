import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

export const Route = createFileRoute("/api/lord/office/powerpoint")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        return Response.json(await callTool("office.powerpoint", body, userId));
      },
    },
  },
});
