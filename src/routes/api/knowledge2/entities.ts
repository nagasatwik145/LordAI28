import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/knowledge2/entities")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context, request }) => {
        try {
          const authContext = context as { supabase?: SupabaseClient<Database> } | undefined;
          const supabase = authContext?.supabase;
          if (!supabase) {
            return Response.json(
              { error: { code: "auth", message: "Unauthorized" } },
              { status: 401 },
            );
          }

          const url = new URL(request.url);
          const sourceId = url.searchParams.get("sourceId");

          let query = supabase
            .from("knowledge_entities")
            .select("*")
            .order("updated_at", { ascending: false });

          if (sourceId) {
            query = query.eq("source_id", sourceId);
          }

          const { data, error } = await query;
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
          const { sourceId, type, name, description, metadata } = body as {
            sourceId?: string;
            type: string;
            name: string;
            description?: string;
            metadata?: Record<string, unknown>;
          };

          if (!name) {
            return Response.json(
              { error: { code: "validation", message: "Name is required" } },
              { status: 400 },
            );
          }

          const { data, error } = await supabase
            .from("knowledge_entities")
            .insert({
              user_id: userId,
              source_id: sourceId ?? null,
              type: type ?? "concept",
              name,
              description: description ?? null,
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
