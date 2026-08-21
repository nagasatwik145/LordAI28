// Image Service — the single client-side facade the UI talks to.
//
// The frontend NEVER calls Cloudflare directly. It goes through this service →
// `/api/images` (server gateway) → the Cloudflare-only pipeline. Cloudflare is
// the only image provider LORD ships, so this facade exposes a single provider.

import { supabase } from "@/integrations/supabase/client";
import type {
  ImageGenerationSuccessBody,
  ImageModelsBody,
  ImagePromptProfile,
} from "@/lib/ai/image";

export interface GenerateImageServiceParams {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  width?: number;
  height?: number;
  count?: number;
  seed?: number;
  model?: string;
  quality?: "fast" | "balanced" | "high";
  enhancePrompt?: boolean;
  profile?: ImagePromptProfile;
  conversationId?: string | null;
  projectId?: string | null;
}

/** A gallery record as stored in the `generated_images` table. */
export interface ImageRecord {
  id: string;
  image_url: string;
  prompt: string;
  revised_prompt: string | null;
  negative_prompt: string | null;
  model: string;
  provider: string;
  width: number | null;
  height: number | null;
  aspect_ratio: string | null;
  seed: number | null;
  is_favorite: boolean;
  created_at: string;
  conversation_id?: string | null;
  project_id?: string | null;
}

export type GenerateImageResult = ImageGenerationSuccessBody & {
  /** True when the gallery schema was missing and the image could not be saved. */
  persistenceWarning: boolean;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    const err = new Error(data?.error ?? "Image generation failed.") as Error & {
      code?: string;
      hint?: string;
      recoverable?: boolean;
    };
    err.code = data?.code;
    err.hint = data?.hint;
    err.recoverable = data?.recoverable;
    throw err;
  }
  return data as T;
}

export const ImageService = {
  async generateImage(params: GenerateImageServiceParams): Promise<GenerateImageResult> {
    const body = await postJson<ImageGenerationSuccessBody>("/api/images", params);
    return { ...body, persistenceWarning: !body.persisted };
  },

  async getModels(): Promise<ImageModelsBody> {
    const res = await fetch("/api/images/models", { method: "GET" });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data?.error ?? "Could not load image models.");
    }
    return data as ImageModelsBody;
  },

  async regenerateImage(
    id: string,
    extra?: { conversationId?: string | null; projectId?: string | null },
  ) {
    const body = await postJson<ImageGenerationSuccessBody>("/api/images/regenerate", {
      id,
      conversationId: extra?.conversationId ?? null,
      projectId: extra?.projectId ?? null,
    });
    return { ...body, persistenceWarning: !body.persisted } as GenerateImageResult;
  },

  async getHistory(limit = 100): Promise<ImageRecord[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("generated_images")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data as ImageRecord[]) ?? [];
  },

  async deleteImage(id: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("generated_images").delete().eq("id", id);
    if (error) throw error;
  },

  async favoriteImage(id: string, favorite: boolean): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("generated_images")
      .update({ is_favorite: favorite })
      .eq("id", id);
    if (error) throw error;
  },

  /** Trigger a browser download for an image URL (data: or remote). */
  downloadImage(url: string, filename = "lordai-image.png"): void {
    if (typeof window === "undefined") return;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noreferrer";
    if (url.startsWith("data:")) {
      a.click();
      return;
    }
    a.target = "_blank";
    a.click();
  },
};
