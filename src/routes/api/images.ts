import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { generateImageWithFallback, ImageGatewayError } from "@/lib/image-gateway.server";
import { IMAGE_MODELS } from "@/lib/lord-config";
import { z } from "zod";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  model: z.string().optional(),
  negativePrompt: z.string().max(4_000).optional(),
  width: z.number().int().min(256).max(4096).optional(),
  height: z.number().int().min(256).max(4096).optional(),
  steps: z.number().int().min(1).max(150).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
  quality: z.enum(["fast", "balanced", "high"]).optional(),
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  count: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]).optional(),
  enhancePrompt: z.boolean().optional(),
  profile: z
    .enum([
      "photorealistic",
      "anime",
      "illustration",
      "pixel-art",
      "ui-design",
      "logo",
      "icons",
      "poster",
      "comic",
    ])
    .optional(),
  sourceImageUrl: z.string().url().max(8_000).optional(),
  editInstruction: z.string().trim().max(8_000).optional(),
});

export const Route = createFileRoute("/api/images")({
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
              provider: "OpenRouter",
              status: 400,
              reason: "Invalid request body",
              retryable: false,
              message: "Provide a valid image prompt.",
              error: {
                code: "INVALID_PROMPT",
                message: "Provide a valid image prompt.",
                requestId,
              },
            },
            { status: 400 },
          );
        }
        try {
          // Verify optional parent resources before spending provider credits.
          // RLS also enforces this, but it cannot provide an actionable API response.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db = context.supabase as any;
          if (parsed.projectId) {
            const { data: project } = await db
              .from("projects")
              .select("id")
              .eq("id", parsed.projectId)
              .eq("user_id", context.userId)
              .maybeSingle();
            if (!project) {
              return Response.json(
                {
                  error: {
                    code: "INVALID_PROMPT",
                    message: "The selected project is unavailable.",
                    requestId,
                  },
                },
                { status: 404 },
              );
            }
          }
          if (parsed.conversationId) {
            const { data: conversation } = await db
              .from("conversations")
              .select("id")
              .eq("id", parsed.conversationId)
              .eq("user_id", context.userId)
              .maybeSingle();
            if (!conversation) {
              return Response.json(
                {
                  error: {
                    code: "INVALID_PROMPT",
                    message: "The selected conversation is unavailable.",
                    requestId,
                  },
                },
                { status: 404 },
              );
            }
          }
          const requestedModel = IMAGE_MODELS.find(
            (model) => model.id === (parsed.model ?? IMAGE_MODELS[0].id),
          );
          if (
            parsed.count &&
            requestedModel &&
            parsed.count > requestedModel.capabilities.maxImages
          ) {
            return Response.json(
              {
                error: {
                  code: "INVALID_PROMPT",
                  message: "This model does not support that image count.",
                  requestId,
                },
              },
              { status: 400 },
            );
          }
          const results = await Promise.all(
            Array.from({ length: parsed.count ?? 1 }, (_, index) =>
              generateImageWithFallback({
                ...parsed,
                seed: parsed.seed === undefined ? undefined : parsed.seed + index,
              }),
            ),
          );
          const result = results[0];
          // The image record is independent of chat persistence; a conversation image is also represented by its message.
          // The Supabase type file is generated from the deployed schema; keep this
          // cast isolated until the migration has been applied and types regenerated.
          for (const generated of results) {
            let messageId: string | null = null;
            if (parsed.conversationId) {
              const { data: message, error: messageError } = await db
                .from("messages")
                .insert({
                  conversation_id: parsed.conversationId,
                  user_id: context.userId,
                  role: "assistant",
                  message_type: "image",
                  content: generated.imageUrl,
                  model: generated.model,
                  project_id: parsed.projectId ?? null,
                })
                .select("id")
                .single();
              if (messageError)
                throw new ImageGatewayError(
                  "IMAGE_GENERATION_FAILED",
                  "The generated image could not be attached to the conversation.",
                  500,
                );
              messageId = message.id;
            }
            const { error: recordError } = await db.from("generated_images").insert({
              user_id: context.userId,
              project_id: parsed.projectId ?? null,
              conversation_id: parsed.conversationId ?? null,
              message_id: messageId,
              prompt: parsed.prompt,
              revised_prompt: generated.enhancedPrompt,
              negative_prompt: parsed.negativePrompt ?? null,
              model: generated.model,
              provider: generated.provider,
              width: generated.width,
              height: generated.height,
              seed: generated.seed ?? null,
              image_url: generated.imageUrl,
              aspect_ratio: `${generated.width}:${generated.height}`,
              queue_time_ms: generated.queueTime,
              generation_time_ms: generated.generationTime,
              retry_count: generated.retryCount,
              fallback_count: generated.fallbackCount,
              estimated_cost: generated.estimatedCost,
              success: true,
            });
            if (recordError)
              throw new ImageGatewayError(
                "IMAGE_GENERATION_FAILED",
                "The generated image could not be saved.",
                500,
              );
          }
          return Response.json(
            { ...result, images: results.map((image) => image.imageUrl) },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          const safe =
            error instanceof ImageGatewayError
              ? error
              : new ImageGatewayError(
                  "IMAGE_GENERATION_FAILED",
                  "Image generation failed. Please try again.",
                  502,
                );
          return Response.json(
            {
              success: false,
              provider: "OpenRouter",
              model: parsed.model,
              status: safe.status,
              reason: safe.reason,
              retryable: safe.retryable,
              message: safe.message,
              error: { code: safe.code, message: safe.message, requestId },
            },
            { status: safe.status, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
