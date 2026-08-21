// Persists client-generated images (e.g. Puter) into the gallery/database.
//
// The existing `/api/images` server gateway already persists OpenRouter/Cloudflare
// results. Puter runs client-side, so its images are POSTed here once generated.
// This endpoint does NOT generate anything — it only records, keeping the public
// `/api/images` contract untouched and avoiding double writes.

import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const requestSchema = z.object({
  images: z.array(z.string().min(1)).min(1).max(8),
  prompt: z.string().trim().min(1).max(8_000),
  model: z.string().min(1).max(256),
  provider: z.string().min(1).max(64),
  revisedPrompt: z.string().max(8_000).optional(),
  negativePrompt: z.string().max(4_000).optional(),
  width: z.number().int().min(1).max(4096).optional(),
  height: z.number().int().min(1).max(4096).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  aspectRatio: z.string().max(16).optional(),
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  generationTimeMs: z.number().int().min(0).max(600_000).optional(),
  estimatedCost: z.number().min(0).max(1_000).optional(),
});

export const Route = createFileRoute("/api/image-persist")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        let parsed: z.infer<typeof requestSchema>;
        try {
          parsed = requestSchema.parse(await request.json());
        } catch {
          return Response.json(
            {
              success: false,
              status: 400,
              message: "Invalid image persistence request.",
              error: { code: "INVALID_REQUEST", requestId },
            },
            { status: 400 },
          );
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db = context.supabase as any;
          if (parsed.projectId) {
            const { data: project } = await db
              .from("projects")
              .select("id")
              .eq("id", parsed.projectId)
              .eq("user_id", context.userId)
              .maybeSingle();
            if (!project)
              return Response.json(
                { error: { code: "INVALID_REQUEST", message: "Project unavailable.", requestId } },
                { status: 404 },
              );
          }
          if (parsed.conversationId) {
            const { data: conversation } = await db
              .from("conversations")
              .select("id")
              .eq("id", parsed.conversationId)
              .eq("user_id", context.userId)
              .maybeSingle();
            if (!conversation)
              return Response.json(
                {
                  error: {
                    code: "INVALID_REQUEST",
                    message: "Conversation unavailable.",
                    requestId,
                  },
                },
                { status: 404 },
              );
          }

          const aspectRatio =
            parsed.aspectRatio ??
            (parsed.width && parsed.height ? `${parsed.width}:${parsed.height}` : null);

          const saved: Array<{ id: string; imageUrl: string }> = [];
          for (let i = 0; i < parsed.images.length; i++) {
            const imageUrl = parsed.images[i];
            let messageId: string | null = null;
            if (parsed.conversationId) {
              const { data: message, error: messageError } = await db
                .from("messages")
                .insert({
                  conversation_id: parsed.conversationId,
                  user_id: context.userId,
                  role: "assistant",
                  message_type: "image",
                  content: imageUrl,
                  model: parsed.model,
                  project_id: parsed.projectId ?? null,
                })
                .select("id")
                .single();
              if (messageError)
                return Response.json(
                  {
                    error: {
                      code: "PERSIST_FAILED",
                      message: "Could not attach image.",
                      requestId,
                    },
                  },
                  { status: 500 },
                );
              messageId = message.id;
            }
            const { data: row, error: recordError } = await db
              .from("generated_images")
              .insert({
                user_id: context.userId,
                project_id: parsed.projectId ?? null,
                conversation_id: parsed.conversationId ?? null,
                message_id: messageId,
                prompt: parsed.prompt,
                revised_prompt: parsed.revisedPrompt ?? null,
                negative_prompt: parsed.negativePrompt ?? null,
                model: parsed.model,
                provider: parsed.provider,
                width: parsed.width ?? null,
                height: parsed.height ?? null,
                seed: parsed.seed != null ? parsed.seed + i : null,
                image_url: imageUrl,
                aspect_ratio: aspectRatio,
                queue_time_ms: 0,
                generation_time_ms: parsed.generationTimeMs ?? 0,
                retry_count: 0,
                fallback_count: 0,
                estimated_cost: parsed.estimatedCost ?? 0,
                success: true,
              })
              .select("id")
              .single();
            if (recordError)
              return Response.json(
                { error: { code: "PERSIST_FAILED", message: "Could not save image.", requestId } },
                { status: 500 },
              );
            saved.push({ id: row.id, imageUrl });
          }

          return Response.json(
            { success: true, provider: parsed.provider, saved },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { error: { code: "PERSIST_FAILED", message: "Could not save image.", requestId } },
            { status: 500 },
          );
        }
      },
    },
  },
});
