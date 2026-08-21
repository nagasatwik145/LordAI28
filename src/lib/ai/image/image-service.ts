// Server-side image service: the thin orchestration layer the API routes call.
//
// It ties the provider-agnostic router to gallery persistence (Supabase). The
// route is responsible only for auth, parsing, and serializing the wire body —
// all image logic lives here or below it. Generation and persistence are kept
// independent: if the database write fails we still return the image to the user.

import { routeImageRequest } from "./image-router";
import type { ImageGenerationRequest, ImageGenerationResult } from "./image-types";
import { createStructuredLogger } from "../shared/structured-logger";

const log = createStructuredLogger("image:service");

/** Run the router and return the normalized result (falls back within Cloudflare). */
export async function generateImage(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  return routeImageRequest(request);
}

/** Minimal shape the service needs from the Supabase client (loose on purpose). */
export interface ImageDbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface PersistImageOptions {
  supabase: ImageDbClient;
  userId: string;
  conversationId?: string | null;
  projectId?: string | null;
}

export interface PersistResult {
  persisted: boolean;
  savedIds: string[];
  error?: string;
}

/**
 * Record a generation in the gallery. Failure here never loses the image: the
 * route still returns `persisted: false` with the data URLs attached.
 */
export async function persistImages(
  result: ImageGenerationResult,
  options: PersistImageOptions,
): Promise<PersistResult> {
  const { supabase, userId, conversationId, projectId } = options;
  const savedIds: string[] = [];

  try {
    if (projectId) {
      const { data: project } = await supabase
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!project) return { persisted: false, savedIds, error: "Project unavailable." };
    }
    if (conversationId) {
      const { data: conversation } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!conversation) return { persisted: false, savedIds, error: "Conversation unavailable." };
    }

    for (let i = 0; i < result.images.length; i += 1) {
      const imageUrl = result.images[i];
      let messageId: string | null = null;
      if (conversationId) {
        const { data: message, error: messageError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            user_id: userId,
            role: "assistant",
            message_type: "image",
            content: imageUrl,
            model: result.model,
            project_id: projectId ?? null,
          })
          .select("id")
          .single();
        if (messageError) return { persisted: false, savedIds, error: "Could not attach image." };
        messageId = message.id;
      }
      const { data: row, error: recordError } = await supabase
        .from("generated_images")
        .insert({
          user_id: userId,
          project_id: projectId ?? null,
          conversation_id: conversationId ?? null,
          message_id: messageId,
          prompt: result.prompt,
          revised_prompt: result.enhancedPrompt,
          negative_prompt: result.negativePrompt ?? null,
          model: result.model,
          provider: result.provider,
          width: result.width,
          height: result.height,
          seed: result.seed != null ? result.seed + i : null,
          image_url: imageUrl,
          aspect_ratio: result.aspectRatio,
          queue_time_ms: result.queueTimeMs,
          generation_time_ms: result.generationTimeMs,
          retry_count: result.retryCount,
          fallback_count: result.fallbackCount,
          estimated_cost: result.estimatedCost,
          success: true,
        })
        .select("id")
        .single();
      if (recordError) return { persisted: false, savedIds, error: "Could not save image." };
      savedIds.push(row.id);
    }

    return { persisted: true, savedIds };
  } catch (error) {
    log.error("persist_failed", { requestId: result.requestId, error: (error as Error)?.message });
    return { persisted: false, savedIds, error: "Could not save image." };
  }
}
