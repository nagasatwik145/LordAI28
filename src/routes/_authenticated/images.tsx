import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Copy, Heart, Trash2, RefreshCw, Pencil, Search, ZoomIn, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Input } from "@/components/ui/input";
import ImageGenerator from "@/components/lord/ImageGenerator";
import { ImageService, type ImageRecord } from "@/services/image/service";
import { getErrorMessage } from "@/lib/error-message";

export const Route = createFileRoute("/_authenticated/images")({
  component: ImagesPage,
  head: () => ({ meta: [{ title: "LORD — Images" }] }),
});

function ImagesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("all");
  const [fullscreen, setFullscreen] = useState<ImageRecord | null>(null);
  const [editTarget, setEditTarget] = useState<{ url: string; prompt: string } | null>(null);

  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["generated-images"],
    queryFn: () => ImageService.getHistory(),
  });

  const images = (data as ImageRecord[]).filter(
    (image) =>
      (model === "all" || image.model === model) &&
      `${image.prompt} ${image.revised_prompt ?? ""}`.toLowerCase().includes(search.toLowerCase()),
  );

  const update = async (id: string, favorite: boolean) => {
    try {
      await ImageService.favoriteImage(id, favorite);
      qc.invalidateQueries({ queryKey: ["generated-images"] });
    } catch {
      toast.error("Could not update image");
    }
  };

  const remove = async (id: string) => {
    try {
      await ImageService.deleteImage(id);
      qc.invalidateQueries({ queryKey: ["generated-images"] });
      toast.success("Image deleted");
    } catch {
      toast.error("Could not delete image");
    }
  };

  const regenerate = async (record: ImageRecord) => {
    try {
      await ImageService.regenerateImage(record.id, {
        conversationId: record.conversation_id ?? null,
        projectId: record.project_id ?? null,
      });
      qc.invalidateQueries({ queryKey: ["generated-images"] });
      toast.success("Regenerating…");
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">Image Generation</h1>
          <p className="text-sm text-muted-foreground">
            Generate, edit, and manage images with the configured provider. Cloudflare, OpenRouter,
            and Puter are supported through a single interface.
          </p>
        </div>

        <ImageGenerator
          key={editTarget ? `edit-${editTarget.url.slice(-12)}` : "new"}
          variant="page"
          initialPrompt={editTarget?.prompt ?? ""}
        />

        <div className="mb-6 mt-10 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search prompts…"
              className="pl-9"
            />
          </div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All models</option>
            <option value="@cf/black-forest-labs/flux-2-klein-9b">Cloudflare FLUX Klein</option>
            {Array.from(new Set((data as ImageRecord[]).map((d) => d.model))).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Loading images…</p>
        ) : isError ? (
          <p className="text-muted-foreground">
            Image history is unavailable in this environment. Generated images can still be used in
            your chat.
          </p>
        ) : images.length === 0 ? (
          <p className="text-muted-foreground">No generated images yet.</p>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {images.map((image) => (
              <article
                key={image.id}
                className="group mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-card transition hover:shadow-[0_0_18px_var(--hud)]"
              >
                <button
                  className="block w-full"
                  onClick={() => setFullscreen(image)}
                  aria-label="Open fullscreen"
                >
                  <img
                    src={image.image_url}
                    alt={image.revised_prompt ?? image.prompt}
                    className="w-full"
                    loading="lazy"
                  />
                </button>
                <div className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm">{image.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {image.provider} · {image.model} · {image.aspect_ratio ?? "—"} ·{" "}
                    {new Date(image.created_at).toLocaleString()}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    <IconBtn
                      label="Download"
                      onClick={() =>
                        ImageService.downloadImage(image.image_url, `lordai-${image.id}.png`)
                      }
                    >
                      <Download className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Copy prompt"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(image.prompt)
                          .then(() => toast.success("Prompt copied"))
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label="Regenerate" onClick={() => regenerate(image)}>
                      <RefreshCw className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label="Edit"
                      onClick={() => {
                        setEditTarget({ url: image.image_url, prompt: image.prompt });
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn
                      label={image.is_favorite ? "Unfavorite" : "Favorite"}
                      onClick={() => update(image.id, !image.is_favorite)}
                    >
                      <Heart
                        className={
                          image.is_favorite ? "h-4 w-4 fill-current text-red-400" : "h-4 w-4"
                        }
                      />
                    </IconBtn>
                    <IconBtn label="View" onClick={() => setFullscreen(image)}>
                      <ZoomIn className="h-4 w-4" />
                    </IconBtn>
                    <IconBtn label="Delete" danger onClick={() => remove(image.id)}>
                      <Trash2 className="h-4 w-4" />
                    </IconBtn>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {fullscreen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-6"
          onClick={() => setFullscreen(null)}
        >
          <button
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2"
            onClick={() => setFullscreen(null)}
            aria-label="Close"
          >
            <X className="h-5 w-5 text-white" />
          </button>
          <img
            src={fullscreen.image_url}
            alt={fullscreen.revised_prompt ?? fullscreen.prompt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 left-1/2 max-w-2xl -translate-x-1/2 text-center text-sm text-white/80">
            {fullscreen.prompt}
          </p>
        </div>
      )}
    </AppShell>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-[color:var(--hud)]/10 hover:text-[color:var(--hud)] ${
        danger ? "hover:bg-destructive/10 hover:text-destructive" : ""
      }`}
    >
      {children}
    </button>
  );
}
