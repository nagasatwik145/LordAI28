import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { getActivity, clearActivity } from "@/lib/lord/index";

export const Route = createFileRoute("/api/lord/activity")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async () => {
        return Response.json(
          { success: true, activity: getActivity(200) },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { clear?: boolean };
        if (body.clear) {
          clearActivity();
          return Response.json({ success: true, message: "Activity log cleared." });
        }
        return Response.json({ success: true, activity: getActivity(200) });
      },
    },
  },
});
