import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import {
  generateImageWithFallback,
  ImageGatewayError,
  type ImageAttempt,
  type ImageGenerationResult,
} from "@/lib/image-gateway.server";
import { IMAGE_MODELS } from "@/lib/lord-config";
import { getImageProvider } from "@/lib/providers/factory.server";
import {
  CLOUDFLARE_DEFAULT_IMAGE_MODEL,
  CloudflareImageProviderError,
} from "@/lib/providers/cloudflare-provider";
import type { GenerateImageParams } from "@/lib/providers/types";
import { z } from "zod";

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  provider: z.enum(["puter", "cloudflare", "openrouter"]).optional(),
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

/**
 * Generate a single image with the Cloudflare Workers AI provider and adapt it
 * to the `ImageGenerationResult` shape the rest of the route already persists.
 * The route loops once per requested image, so this always produces exactly one
 * image. Cloudflare-specific errors are wrapped in the server `ImageGatewayError`
 * so the route's existing error handling / response stays unchanged.
 */
async function generateCloudflareImage(
  input: z.infer<typeof requestSchema>,
  requestId: string,
): Promise<ImageGenerationResult> {
  const provider = getImageProvider("cloudflare");
  if (!provider) {
    throw new ImageGatewayError(
      "IMAGE_GENERATION_FAILED",
      "Cloudflare provider is unavailable.",
      502,
    );
  }
  try {
    const params: GenerateImageParams = {
      prompt: input.prompt,
      model: input.model,
      width: input.width,
      height: input.height,
      quality: input.quality,
      seed: input.seed,
      negativePrompt: input.negativePrompt,
      enhancePrompt: input.enhancePrompt,
      // One image per call; the route loops to satisfy `count`.
      count: 1,
    };
    const unified = await provider.generateImage(params);
    const imageUrl = unified.images[0];
    if (!imageUrl) {
      throw new ImageGatewayError("IMAGE_GENERATION_FAILED", "Cloudflare returned no image.", 502);
    }
    return {
      imageUrl,
      model: unified.model,
      provider: "Cloudflare",
      generationTime: unified.generationTime,
      revisedPrompt: undefined,
      seed: input.seed,
      width: input.width ?? 1024,
      height: input.height ?? 1024,
      enhancedPrompt: input.prompt,
      queueTime: 0,
      retryCount: 0,
      fallbackCount: 0,
      estimatedCost: unified.cost,
    };
  } catch (error) {
    if (error instanceof ImageGatewayError) throw error;
    if (error instanceof CloudflareImageProviderError) {
      throw new ImageGatewayError(
        error.code as ImageGatewayError["code"],
        error.message,
        error.status,
        error.retryable,
        error.message,
        false,
        undefined,
        error.hint,
      );
    }
    throw new ImageGatewayError(
      "IMAGE_GENERATION_FAILED",
      error instanceof Error ? error.message : "Cloudflare image generation failed.",
      502,
    );
  }
}

export const Route = createFileRoute("/api/images")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      POST: async ({ request, context }) => {
        const requestId = crypto.randomUUID();
        const logger = {
          warn: (m: string, p?: Record<string, unknown>) =>
            console.warn("[api/images]", m, p ?? ""),
          error: (m: string, p?: Record<string, unknown>) =>
            console.error("[api/images]", m, p ?? ""),
        };
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
            requestedModel &&
            parsed.count &&
            parsed.count > requestedModel.capabilities.maxImages
          ) {
            return Response.json(
              {
                error: {
                  code: "INVALID_PROMPT",
                  message: `This model supports up to ${requestedModel.capabilities.maxImages} images per request.`,
                  requestId,
                },
              },
              { status: 400 },
            );
          }

          const useCloudflare = parsed.provider === "cloudflare";
          const providerLabel = useCloudflare ? "Cloudflare" : "OpenRouter";
          const count = Math.min(parsed.count ?? 1, requestedModel?.capabilities.maxImages ?? 4);
          // Generate each image independently so one rejected model cannot
          // prevent the others; automatic fallback runs per image. Cloudflare is
          // served by its dedicated provider; everything else by the OpenRouter
          // image gateway. Both paths return the same ImageGenerationResult shape.
          const settled = await Promise.allSettled(
            Array.from({ length: count }, (_, index) => {
              const seed = parsed.seed === undefined ? undefined : parsed.seed + index;
              return useCloudflare
                ? generateCloudflareImage({ ...parsed, seed }, requestId)
                : generateImageWithFallback({ ...parsed, seed }, requestId);
            }),
          );

          const results = settled
            .filter(
              (
                r,
              ): r is PromiseFulfilledResult<
                Awaited<ReturnType<typeof generateImageWithFallback>>
              > => r.status === "fulfilled",
            )
            .map((r) => r.value);

          if (results.length === 0) {
            // Every image failed — surface the first rejection with full detail.
            const first = settled[0];
            const err = first && first.status === "rejected" ? first.reason : null;
            const gatewayErr = err instanceof ImageGatewayError ? err : null;
            const attempts: ImageAttempt[] =
              (gatewayErr as unknown as { attempts?: ImageAttempt[] })?.["attempts"] ?? [];
            return Response.json(
              {
                success: false,
                provider: providerLabel,
                model: parsed.model,
                status: gatewayErr?.status ?? 502,
                reason: gatewayErr?.reason ?? "IMAGE_GENERATION_FAILED",
                retryable: gatewayErr?.retryable ?? true,
                message: gatewayErr?.message ?? "Image generation failed. Please try again.",
                error: {
                  code: gatewayErr?.code ?? "IMAGE_GENERATION_FAILED",
                  message: gatewayErr?.message ?? "Image generation failed. Please try again.",
                  hint: gatewayErr?.hint,
                  providerMessage: gatewayErr?.providerMessage,
                  requestId,
                  attempts,
                },
              },
              { status: gatewayErr?.status ?? 502, headers: { "Cache-Control": "no-store" } },
            );
          }

          // Persistence is best-effort: a billable image must never be lost just
          // because the analytics table is unavailable in this deployment.
          let persisted = true;
          let persistenceWarning: string | null = null;
          for (const generated of results) {
            let messageId: string | null = null;
            try {
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
                if (messageError) throw messageError;
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
              if (recordError) throw recordError;
            } catch (persistError) {
              persisted = false;
              const persistMessage =
                persistError instanceof Error ? persistError.message : String(persistError);
              const isSchemaIssue =
                /generated_images|relation .* does not exist|column .* does not exist/i.test(
                  persistMessage,
                );
              persistenceWarning = isSchemaIssue
                ? "The image was generated but could not be saved: the gallery schema is missing. Apply supabase/migrations/20260821000000_generated_images.sql and 20260821000001_image_generation_analytics.sql (and 20260808000002_add_image_type_column.sql for messages.message_type)."
                : "The image was generated but could not be saved to the gallery in this environment.";
              logger.warn("image_persistence_failed", {
                requestId,
                error: persistMessage,
              });
            }
          }

          const fallbackUsed = results.some((r) => r.fallbackCount > 0);
          const usedModel = results[0].model;
          const usedLabel = IMAGE_MODELS.find((m) => m.id === usedModel)?.label ?? usedModel;
          const requestedModelId =
            parsed.model ?? (useCloudflare ? CLOUDFLARE_DEFAULT_IMAGE_MODEL : IMAGE_MODELS[0].id);
          const requestedLabel =
            IMAGE_MODELS.find((m) => m.id === requestedModelId)?.label ?? requestedModelId;

          return Response.json(
            {
              success: true,
              requestId,
              requestedModel: requestedModelId,
              requestedModelLabel: requestedLabel,
              model: usedModel,
              modelLabel: usedLabel,
              fallbackUsed,
              provider: results[0].provider,
              imageUrl: results[0].imageUrl,
              images: results.map((image) => image.imageUrl),
              results: results.map((r) => ({
                model: r.model,
                modelLabel: IMAGE_MODELS.find((m) => m.id === r.model)?.label ?? r.model,
                imageUrl: r.imageUrl,
                generationTime: r.generationTime,
                fallbackCount: r.fallbackCount,
                estimatedCost: r.estimatedCost,
              })),
              persisted,
              ...(persistenceWarning ? { warning: persistenceWarning } : {}),
              generationTime: results[0].generationTime,
            },
            {
              status: persisted ? 200 : 207,
              headers: { "Cache-Control": "no-store" },
            },
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
              provider: parsed.provider === "cloudflare" ? "Cloudflare" : "OpenRouter",
              model: parsed.model,
              status: safe.status,
              reason: safe.reason,
              retryable: safe.retryable,
              message: safe.message,
              error: {
                code: safe.code,
                message: safe.message,
                hint: safe.hint,
                providerMessage: safe.providerMessage,
                requestId,
              },
            },
            { status: safe.status, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
