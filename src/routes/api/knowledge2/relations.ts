import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/knowledge2/relations")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        try {
          const authContext = context as { supabase?: SupabaseClient<Database> } | undefined;
          const supabase = authContext?.supabase;
          if (!supabase) {
            return Response.json(
              { error: { code: "auth", message: "Unauthorized" } },
              { status: 401 },
            );
          }

          const { data, error } = await supabase
            .from("knowledge_relations")
            .select("*")
            .order("created_at", { ascending: false });

          if (error) throw error;
          return Response.json({ data: data ?? [] });
        } catch (error) {
          return Response.json(
            { error: { code: "internal", message: (error as Error).message } },
            { status: 500 },
          );
        }
      },
      POST: async ({ context, request }) => {
        try {
          const authContext = context as
            { userId?: string; supabase?: SupabaseClient<Database> } | undefined;
          const userId = authContext?.userId;
          const supabase = authContext?.supabase;
          if (!userId || !supabase) {
            return Response.json(
              { error: { code: "auth", message: "Unauthorized" } },
              { status: 401 },
            );
          }

          const body = await request.json();
          const { sourceEntityId, targetEntityId, relationType, confidence, metadata } = body as {
            sourceEntityId: string;
            targetEntityId: string;
            relationType: string;
            confidence?: number;
            metadata?: Record<string, unknown>;
          };

          if (!sourceEntityId || !targetEntityId || !relationType) {
            return Response.json(
              {
                error: {
                  code: "validation",
                  message: "sourceEntityId, targetEntityId, and relationType are required",
                },
              },
              { status: 400 },
            );
          }

          const { data, error } = await supabase
            .from("knowledge_relations")
            .insert({
              user_id: userId,
              source_entity_id: sourceEntityId,
              target_entity_id: targetEntityId,
              relation_type: relationType,
              confidence: confidence ?? 1.0,
              metadata: (metadata ?? {}) as Json,
            })
            .select()
            .single();

          if (error) throw error;
          return Response.json({ data }, { status: 201 });
        } catch (error) {
          return Response.json(
            { error: { code: "internal", message: (error as Error).message } },
            { status: 500 },
          );
        }
      },
    },
  },
});
