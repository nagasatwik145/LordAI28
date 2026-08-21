import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

const ACTION_TOOL: Record<string, string> = {
  control: "sm.control",
  read_sensors: "sm.read_sensors",
  add: "sm.add_device",
};

export const Route = createFileRoute("/api/lord/iot/device/action")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        const tool = ACTION_TOOL[String(body.action ?? "control")] ?? "sm.control";
        return Response.json(await callTool(tool, body, userId));
      },
    },
  },
});
