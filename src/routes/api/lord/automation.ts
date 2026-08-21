import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

const ACTION_TOOL: Record<string, string> = {
  list: "automation.list",
  create: "automation.create",
  run: "automation.run",
  delete: "automation.delete",
};

export const Route = createFileRoute("/api/lord/automation")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const userId = (context as { userId?: string }).userId;
        return Response.json(await callTool("automation.list", {}, userId));
      },
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        const tool = ACTION_TOOL[String(body.action ?? "list")] ?? "automation.list";
        return Response.json(await callTool(tool, body, userId));
      },
    },
  },
});
