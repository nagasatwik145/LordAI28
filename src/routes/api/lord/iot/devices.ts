import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

export const Route = createFileRoute("/api/lord/iot/devices")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        const userId = (context as { userId?: string }).userId;
        return Response.json(await callTool("sm.devices", {}, userId));
      },
    },
  },
});
