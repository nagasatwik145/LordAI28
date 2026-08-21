import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

const ACTION_TOOL: Record<string, string> = {
  open: "browser.open",
  navigate: "browser.open",
  search: "browser.search",
  summarize: "browser.summarize",
  submit: "browser.submit_form",
};

export const Route = createFileRoute("/api/lord/browser/action")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        const tool = ACTION_TOOL[String(body.action ?? "open")] ?? "browser.open";
        return Response.json(await callTool(tool, body, userId));
      },
    },
  },
});
