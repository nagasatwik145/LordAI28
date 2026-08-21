import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { stopAll, resumeAll } from "@/lib/lord/api";

export const Route = createFileRoute("/api/lord/agent/stop")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as { resume?: boolean };
          if (body.resume) {
            resumeAll();
            return Response.json({ success: true, message: "Operations resumed." });
          }
          const { stopped } = stopAll();
          return Response.json({
            success: true,
            message: `STOP LORD activated. ${stopped} execution(s) aborted.`,
            stopped,
          });
        } catch (err) {
          return Response.json(
            { success: false, error: err instanceof Error ? err.message : "Stop failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
