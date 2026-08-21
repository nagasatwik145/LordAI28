import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  generateImage,
  persistImages,
  toImageErrorBody,
  ImageGenerationError,
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  isRegisteredImageModel,
  resolveConfiguredModelId,
} from "@/lib/ai/image";
import type { ImageGenerationRequest } from "@/lib/ai/image";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  model: z.string().optional(),
  negativePrompt: z.string().max(4_000).optional(),
  width: z.number().int().min(64).max(4096).optional(),
  height: z.number().int().min(64).max(4096).optional(),
  aspectRatio: z.string().max(16).optional(),
  quality: z.enum(["fast", "balanced", "high"]).optional(),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
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
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/images")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ context }) => {
        // Image history for the authenticated user (structured, no secrets).
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (context.supabase as any)
            .from("generated_images")
            .select("*")
            .eq("user_id", context.userId)
            .order("created_at", { ascending: false })
            .limit(100);
          if (error) throw error;
          return Response.json(
            { success: true, images: data ?? [] },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch {
          return Response.json(
            { success: false, error: "Could not load image history." },
            { status: 500 },
          );
        }
      },
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        let parsed: z.infer<typeof requestSchema>;
        try {
          parsed = requestSchema.parse(await request.json());
        } catch {
          return Response.json(
            {
              success: false,
              error: "Provide a valid image prompt.",
              recoverable: false,
              code: "INVALID_REQUEST" as const,
              requestId,
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
            if (!project) {
              return Response.json(
                {
                  success: false,
                  error: "The selected project is unavailable.",
                  recoverable: false,
                  code: "INVALID_REQUEST" as const,
                  requestId,
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
                  success: false,
                  error: "The selected conversation is unavailable.",
                  recoverable: false,
                  code: "INVALID_REQUEST" as const,
                  requestId,
                },
                { status: 404 },
              );
            }
          }

          // Cloudflare-only: reject unknown model ids instead of guessing.
          const requestedModel =
            parsed.model ?? resolveConfiguredModelId(process.env.CLOUDFLARE_IMAGE_MODEL).id;
          if (!isRegisteredImageModel(requestedModel)) {
            return Response.json(
              {
                success: false,
                error: "Unknown image model.",
                recoverable: false,
                code: "INVALID_MODEL" as const,
                requestId,
              },
              { status: 400 },
            );
          }

          const modelEntry = getImageModel(requestedModel)!;
          const count = Math.min(parsed.count ?? 1, modelEntry.maxImages);

          const imageRequest: ImageGenerationRequest = {
            prompt: parsed.prompt,
            model: requestedModel,
            negativePrompt: parsed.negativePrompt,
            width: parsed.width,
            height: parsed.height,
            aspectRatio: parsed.aspectRatio,
            quality: parsed.quality,
            count,
            seed: parsed.seed,
            enhancePrompt: parsed.enhancePrompt,
            profile: parsed.profile,
            conversationId: parsed.conversationId ?? null,
            projectId: parsed.projectId ?? null,
          };

          const result = await generateImage(imageRequest);
          const { persisted, error: persistError } = await persistImages(result, {
            supabase: db,
            userId: context.userId,
            conversationId: parsed.conversationId ?? null,
            projectId: parsed.projectId ?? null,
          });

          return Response.json(
            {
              success: true,
              requestId: result.requestId,
              provider: result.provider,
              providerLabel: result.providerLabel,
              model: result.model,
              modelLabel: result.modelLabel,
              requestedModel: result.requestedModel,
              requestedModelLabel: result.requestedModelLabel,
              fallbackUsed: result.fallbackUsed,
              fallbackCount: result.fallbackCount,
              retryCount: result.retryCount,
              imageUrl: result.images[0],
              images: result.images,
              width: result.width,
              height: result.height,
              aspectRatio: result.aspectRatio,
              seed: result.seed,
              enhancedPrompt: result.enhancedPrompt,
              generationTime: result.generationTimeMs,
              queueTime: result.queueTimeMs,
              estimatedCost: result.estimatedCost,
              attempts: result.attempts,
              persisted,
              ...(persisted
                ? {}
                : { warning: persistError ?? "Image could not be saved to the gallery." }),
            } satisfies Record<string, unknown>,
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          if (error instanceof ImageGenerationError) {
            return Response.json(toImageErrorBody(error, requestId), { status: error.status });
          }
          return Response.json(toImageErrorBody(error, requestId), { status: 500 });
        }
      },
    },
  },
});

export { DEFAULT_IMAGE_MODEL_ID };
