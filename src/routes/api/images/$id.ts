// GET one image + DELETE one image by id. Reuses the existing auth middleware
// and gallery table; no provider logic is duplicated here.

import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";

export const Route = createFileRoute("/api/images/$id")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ params, context }) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (context.supabase as any)
            .from("generated_images")
            .select("*")
            .eq("id", params.id)
            .eq("user_id", context.userId)
            .maybeSingle();
          if (error) throw error;
          if (!data) {
            return Response.json({ success: false, error: "Image not found." }, { status: 404 });
          }
          return Response.json(
            { success: true, image: data },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json({ success: false, error: "Could not load image." }, { status: 500 });
        }
      },
      DELETE: async ({ params, context }) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (context.supabase as any)
            .from("generated_images")
            .delete()
            .eq("id", params.id)
            .eq("user_id", context.userId);
          if (error) throw error;
          return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
        } catch {
          return Response.json(
            { success: false, error: "Could not delete image." },
            { status: 500 },
          );
        }
      },
    },
  },
});
