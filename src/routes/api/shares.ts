import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { apiErrorResponse, getSafeErrorMessage } from "@/lib/api-error";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ShareRecord } from "@/lib/share";

const requestId = () => crypto.randomUUID();

const CreateShareSchema = z.object({
  conversationId: z.string().uuid(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const Route = createFileRoute("/api/shares")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      // List the current user's shares (one per conversation).
      GET: async ({ context }) => {
        console.info(
          JSON.stringify({ event: "shares_handler_enter", message: "SHARES HANDLER ENTER" }),
        );
        const { supabase, userId } = context as {
          supabase: SupabaseClient<Database>;
          userId: string;
        };
        const rid = requestId();
        const { data, error } = await supabase
          .from("conversation_shares")
          .select("*")
          .eq("created_by", userId)
          .order("created_at", { ascending: false });
        if (error) {
          return apiErrorResponse(500, "INTERNAL_ERROR", getSafeErrorMessage(error), rid);
        }
        console.info(
          JSON.stringify({
            event: "shares_handler_exit",
            message: "SHARES HANDLER EXIT",
            status: 200,
          }),
        );
        return Response.json({ shares: data as ShareRecord[] });
      },

      // Create (or return existing) share for a conversation the user owns.
      POST: async ({ request, context }) => {
        console.info(
          JSON.stringify({ event: "shares_handler_enter", message: "SHARES HANDLER ENTER" }),
        );
        const { supabase, userId } = context as {
          supabase: SupabaseClient<Database>;
          userId: string;
        };
        const rid = requestId();

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return apiErrorResponse(400, "INVALID_REQUEST", "Request body must be valid JSON.", rid);
        }
        const parsed = CreateShareSchema.safeParse(raw);
        if (!parsed.success) {
          return apiErrorResponse(
            400,
            "INVALID_REQUEST",
            "Send a valid conversationId (uuid) and optional expiresAt.",
            rid,
          );
        }
        const { conversationId, expiresAt } = parsed.data;

        // The INSERT RLS policy already guarantees ownership, but we double-check
        // here to return a clear 403 instead of a generic RLS failure.
        const { data: conv, error: convErr } = await supabase
          .from("conversations")
          .select("id")
          .eq("id", conversationId)
          .eq("user_id", userId)
          .maybeSingle();
        if (convErr) {
          return apiErrorResponse(500, "INTERNAL_ERROR", getSafeErrorMessage(convErr), rid);
        }
        if (!conv) {
          return apiErrorResponse(
            403,
            "INVALID_REQUEST",
            "You can only share conversations you own.",
            rid,
          );
        }

        // One share per conversation: return the existing one if present.
        const { data: existing, error: existErr } = await supabase
          .from("conversation_shares")
          .select("*")
          .eq("conversation_id", conversationId)
          .eq("created_by", userId)
          .maybeSingle();
        if (existErr) {
          return apiErrorResponse(500, "INTERNAL_ERROR", getSafeErrorMessage(existErr), rid);
        }
        if (existing) {
          console.info(
            JSON.stringify({
              event: "shares_handler_exit",
              message: "SHARES HANDLER EXIT",
              status: 200,
            }),
          );
          return Response.json({ share: existing as ShareRecord, created: false });
        }

        const { data: created, error: createErr } = await supabase
          .from("conversation_shares")
          .insert({
            conversation_id: conversationId,
            created_by: userId,
            expires_at: expiresAt ?? null,
            is_public: true,
          })
          .select()
          .single();
        if (createErr) {
          // Unique violation on (conversation_id) → concurrent creation; fetch it.
          if (createErr.code === "23505") {
            const { data: retry } = await supabase
              .from("conversation_shares")
              .select("*")
              .eq("conversation_id", conversationId)
              .eq("created_by", userId)
              .maybeSingle();
            if (retry) return Response.json({ share: retry as ShareRecord, created: false });
          }
          return apiErrorResponse(500, "INTERNAL_ERROR", getSafeErrorMessage(createErr), rid);
        }
        console.info(
          JSON.stringify({
            event: "shares_handler_exit",
            message: "SHARES HANDLER EXIT",
            status: 200,
          }),
        );
        return Response.json({ share: created as ShareRecord, created: true });
      },
    },
  },
});
