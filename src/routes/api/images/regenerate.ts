// POST /api/images/regenerate — re-run a stored generation from its record.
//
// Reads the stored image (ownership-checked), then delegates to the same
// Cloudflare-only pipeline used by POST /api/images. Always produces a fresh
// variation. The UI never learns which provider ran.

import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  generateImage,
  persistImages,
  toImageErrorBody,
  ImageGenerationError,
} from "@/lib/ai/image";
import type { ImageGenerationRequest } from "@/lib/ai/image";

const requestSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});

export const Route = createFileRoute("/api/images/regenerate")({
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
            { success: false, error: "Invalid regenerate request." },
            { status: 400 },
          );
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const db = context.supabase as any;
          const { data: record, error } = await db
            .from("generated_images")
            .select("*")
            .eq("id", parsed.id)
            .eq("user_id", context.userId)
            .maybeSingle();
          if (error || !record) {
            return Response.json({ success: false, error: "Image not found." }, { status: 404 });
          }

          const ratio: string = record.aspect_ratio ?? "1:1";
          const [w, h] = ratio.split(":").map(Number);
          const width = w && h ? (w >= h ? 1024 : Math.round((1024 * w) / h)) : 1024;
          const height = w && h ? (h >= w ? 1024 : Math.round((1024 * h) / w)) : 1024;

          const imageRequest: ImageGenerationRequest = {
            prompt: record.prompt,
            model: record.model,
            negativePrompt: record.negative_prompt ?? undefined,
            width,
            height,
            aspectRatio: ratio,
            seed: record.seed ?? undefined,
            enhancePrompt: false,
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
            },
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
