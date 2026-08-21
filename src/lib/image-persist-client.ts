// Client helper: persists a generated image (typically Puter) to the gallery.
//
// Server-generated images are already persisted by `/api/images`; this is only
// needed for client-side providers whose bytes never touch our server.

import { authenticatedFetch } from "./authenticated-fetch";
import { getApiBaseUrl } from "./api-config";

export interface PersistImageRequest {
  images: string[];
  prompt: string;
  model: string;
  provider: string;
  revisedPrompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  aspectRatio?: string;
  conversationId?: string | null;
  projectId?: string | null;
  generationTimeMs?: number;
  estimatedCost?: number;
}

export async function persistGeneratedImage(req: PersistImageRequest): Promise<boolean> {
  try {
    const res = await authenticatedFetch(`${getApiBaseUrl()}/api/image-persist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    return res.ok;
  } catch {
    return false;
  }
}
