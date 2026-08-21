import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiErrorResponse } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const ExamListSchema = z.object({
  action: z.literal("list"),
  status: z.enum(["draft", "in_progress", "completed", "abandoned"]).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const Route = createFileRoute("/api/learning/exams")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const parsed = ExamListSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return apiErrorResponse(400, "INVALID_REQUEST", "Invalid exam list request.", requestId);
        }

        const auth = context as {
          userId?: string;
          supabase?: SupabaseClient<Database>;
        };
        if (!auth.userId || !auth.supabase) {
          return apiErrorResponse(
            401,
            "AI_AUTH_ERROR",
            "Sign in to use learning tools.",
            requestId,
          );
        }

        const supabase = auth.supabase as SupabaseClient<Database>;
        const userId = auth.userId;

        let query = supabase
          .from("learning_exams")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (parsed.data.status) {
          query = query.eq("status", parsed.data.status);
        }

        const { data, error } = await query.limit(parsed.data.limit ?? 20);
        if (error) {
          return apiErrorResponse(500, "INTERNAL_ERROR", "Failed to list exams.", requestId);
        }

        return Response.json({ exams: data ?? [] });
      },
    },
  },
});
