import { createFileRoute } from "@tanstack/react-router";
import { Download, Copy, Heart, Trash2, Maximize2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell } from "@/components/lord/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_MODELS } from "@/lib/lord-config";

type ImageRow = {
  id: string;
  image_url: string;
  prompt: string;
  revised_prompt: string | null;
  model: string;
  created_at: string;
  is_favorite: boolean;
};
export const Route = createFileRoute("/_authenticated/images")({
  component: ImagesPage,
  head: () => ({ meta: [{ title: "LORD — Images" }] }),
});

function ImagesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [model, setModel] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["generated-images"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("generated_images")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as ImageRow[];
    },
  });
  const images = useMemo(
    () =>
      data.filter(
        (image) =>
          (model === "all" || image.model === model) &&
          `${image.prompt} ${image.revised_prompt ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [data, model, search],
  );
  const update = async (id: string, patch: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("generated_images").update(patch).eq("id", id);
    if (error) toast.error("Could not update image");
    else qc.invalidateQueries({ queryKey: ["generated-images"] });
  };
  const remove = async (id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("generated_images").delete().eq("id", id);
    if (error) toast.error("Could not delete image");
    else qc.invalidateQueries({ queryKey: ["generated-images"] });
  };
  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white">Image Gallery</h1>
          <p className="text-sm text-muted-foreground">
            Your generated images, prompts, and creative history.
          </p>
        </div>
        <div className="mb-6 flex flex-wrap gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompts…"
            className="max-w-sm"
          />
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border bg-background px-3 text-sm"
          >
            <option value="all">All models</option>
            {IMAGE_MODELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        {isLoading ? (
          <p className="text-muted-foreground">Loading images…</p>
        ) : images.length === 0 ? (
          <p className="text-muted-foreground">No generated images yet.</p>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4">
            {images.map((image) => (
              <article
                key={image.id}
                className="mb-4 break-inside-avoid overflow-hidden rounded-xl border bg-card"
              >
                <img
                  src={image.image_url}
                  alt={image.revised_prompt ?? image.prompt}
                  className="w-full"
                  loading="lazy"
                />
                <div className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm">{image.prompt}</p>
                  <p className="text-xs text-muted-foreground">
                    {IMAGE_MODELS.find((m) => m.id === image.model)?.label ?? image.model}
                  </p>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(image.prompt)
                          .then(() => toast.success("Prompt copied"))
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => update(image.id, { is_favorite: !image.is_favorite })}
                    >
                      <Heart
                        className={
                          image.is_favorite ? "h-4 w-4 fill-current text-red-400" : "h-4 w-4"
                        }
                      />
                    </Button>
                    <Button size="icon" variant="ghost" asChild>
                      <a href={image.image_url} download target="_blank" rel="noreferrer">
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => window.open(image.image_url, "_blank", "noopener,noreferrer")}
                    >
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(image.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
