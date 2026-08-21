import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

export const Route = createFileRoute("/api/lord/mobile/pair")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        // Completing a pairing requires a token; otherwise start a new session.
        const tool = body.token ? "mobile.pair_complete" : "mobile.pair_start";
        return Response.json(await callTool(tool, body, userId));
      },
    },
  },
});
