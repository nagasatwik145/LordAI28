import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Copy, RefreshCw, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageService, type ImageRecord } from "@/services/image/service";
import {
  getImageGenDefaults,
  setImageGenDefaults,
  resolveDimensions,
  type ImageSizePreset,
} from "@/lib/image-settings";
import {
  IMAGE_MODEL_REGISTRY,
  DEFAULT_IMAGE_MODEL_ID,
  inferImagePromptProfile,
} from "@/lib/ai/image";
import { getErrorMessage, getErrorCode, getErrorHint } from "@/lib/error-message";

type Stage = "idle" | "preparing" | "generating" | "saving" | "done" | "error";

const ASPECT_OPTIONS = ["1:1", "16:9", "9:16", "4:3", "3:4"];
const SIZE_PRESETS: { id: ImageSizePreset; label: string }[] = [
  { id: "square", label: "Square" },
  { id: "portrait", label: "Portrait" },
  { id: "landscape", label: "Landscape" },
];

export default function ImageGenerator({
  conversationId,
  projectId,
  onInsert,
  variant = "page",
  initialPrompt = "",
}: {
  conversationId?: string | null;
  projectId?: string | null;
  onInsert?: (urls: string[]) => void;
  variant?: "page" | "modal";
  initialPrompt?: string;
}) {
  const defaults = getImageGenDefaults();

  const [prompt, setPrompt] = useState(initialPrompt);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [sizePreset, setSizePreset] = useState<ImageSizePreset>(defaults.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState(defaults.defaultAspectRatio);
  const [count, setCount] = useState(defaults.defaultImageCount);
  const [seed, setSeed] = useState<string>("");
  const [model, setModel] = useState(defaults.defaultModel || DEFAULT_IMAGE_MODEL_ID);
  const [quality, setQuality] = useState<"fast" | "balanced" | "high">(defaults.defaultQuality);
  const [enhancePrompt, setEnhancePrompt] = useState(defaults.enhancePrompt);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [meta, setMeta] = useState<{ provider: string; model: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setImageGenDefaults({
      defaultResolution: sizePreset,
      defaultAspectRatio: aspectRatio,
      defaultImageCount: count,
      defaultQuality: quality,
      enhancePrompt,
      defaultModel: model,
    });
  }, [sizePreset, aspectRatio, count, quality, enhancePrompt, model]);

  const effectivePrompt = prompt.trim();
  const canGenerate = effectivePrompt.length > 0 && !busy;

  async function run() {
    if (!canGenerate) return;
    setBusy(true);
    setError(null);
    setErrorHint(null);
    setImages([]);
    setMeta(null);
    setStage("preparing");
    const { width, height } = resolveDimensions(sizePreset, aspectRatio);
    const seedNum = seed.trim() === "" ? undefined : Number(seed);
    const profile = inferImagePromptProfile(effectivePrompt);
    try {
      setStage("generating");
      const res = await ImageService.generateImage({
        prompt: effectivePrompt,
        negativePrompt: negativePrompt.trim() || undefined,
        aspectRatio,
        width,
        height,
        count,
        seed: seedNum,
        model,
        quality,
        enhancePrompt,
        profile,
        conversationId,
        projectId,
      });
      setImages(res.images);
      setMeta({ provider: res.providerLabel, model: res.modelLabel ?? res.model });
      setStage("done");
      toast.success("Image generated");
    } catch (e) {
      setStage("error");
      const message = getErrorMessage(e);
      const hint = getErrorHint(e);
      const code = getErrorCode(e);
      setError(message);
      setErrorHint(hint ?? null);
      if (code && import.meta.env.DEV) {
        console.error("[image-gen] generation failed:", { code, message, hint });
      }
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    await run();
    setRegenerating(false);
  }

  function reset() {
    setImages([]);
    setMeta(null);
    setStage("idle");
    setError(null);
    setErrorHint(null);
  }

  const finish = () => {
    if (images.length) onInsert?.(images);
  };

  const cardShell =
    variant === "modal" ? "rounded-2xl bg-[#031426] p-6" : "hud-panel rounded-xl p-6";

  const modelOptions = useMemo(
    () => IMAGE_MODEL_REGISTRY.map((m) => ({ id: m.id, label: m.label })),
    [],
  );

  return (
    <div className={cardShell}>
      {/* Provider badge (Cloudflare is the only provider) */}
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-4 w-4 text-[color:var(--hud)]" />
        <span>Cloudflare Workers AI</span>
      </div>

      {/* Prompt */}
      <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
        Prompt
      </label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the image you want to create…"
        className="w-full rounded-md border border-border/40 bg-background/30 p-3 text-sm text-white outline-none focus:border-[color:var(--hud)]/50"
        rows={4}
      />

      {/* Negative prompt */}
      <div className="mt-3">
        <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
          Negative Prompt <span className="opacity-60">(optional)</span>
        </label>
        <Input
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="What to avoid (blurry, extra limbs, watermark)…"
          className="bg-background/30"
        />
      </div>

      {/* Size + aspect ratio */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
            Image Size
          </label>
          <div className="flex gap-2">
            {SIZE_PRESETS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSizePreset(s.id)}
                className={`flex-1 rounded-md border px-2 py-2 text-xs font-medium transition ${
                  sizePreset === s.id
                    ? "border-[color:var(--hud)] bg-[color:var(--hud)]/15 text-[color:var(--hud)]"
                    : "border-border/40 text-muted-foreground hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
            Aspect Ratio
          </label>
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value)}
            className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
          >
            {ASPECT_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Count + seed */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
            Number of Images (1–4)
          </label>
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
            Seed <span className="opacity-60">(optional)</span>
          </label>
          <Input
            value={seed}
            onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="Random"
            inputMode="numeric"
            className="bg-background/30"
          />
        </div>
      </div>

      {/* Advanced settings */}
      <div className="mt-3">
        <button
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md border border-border/30 bg-background/20 px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span>Advanced Settings</span>
        </button>
        {advancedOpen && (
          <div className="mt-2 grid gap-3 rounded-md border border-border/30 bg-background/20 p-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
              >
                <option value={DEFAULT_IMAGE_MODEL_ID}>Default (auto)</option>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Quality
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as "fast" | "balanced" | "high")}
                className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
              >
                <option value="high">High</option>
                <option value="balanced">Balanced</option>
                <option value="fast">Fast</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground/90">
              <input
                type="checkbox"
                checked={enhancePrompt}
                onChange={(e) => setEnhancePrompt(e.target.checked)}
              />
              Enhance prompt
            </label>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            {errorHint && <p className="mt-1 text-red-300/80">{errorHint}</p>}
          </div>
        </div>
      )}

      {/* Busy */}
      {busy && (
        <div className="mt-3 flex items-center gap-3 rounded-md border border-[color:var(--hud)]/30 bg-[color:var(--hud)]/5 p-3 text-sm text-[color:var(--hud)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>
            {stage === "generating"
              ? "Sending request to Cloudflare…"
              : stage === "preparing"
                ? "Preparing request…"
                : "Working…"}
          </span>
        </div>
      )}

      {/* Result gallery */}
      {images.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {images.map((url, i) => (
            <GeneratedImageCard
              key={i}
              url={url}
              prompt={effectivePrompt}
              provider={meta?.provider}
              model={meta?.model}
              onRegenerate={regenerate}
              onInsert={onInsert}
              regenerating={regenerating}
            />
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {stage === "done" && images.length > 0 ? (
          <Button onClick={finish} className="bg-emerald-500 hover:bg-emerald-600">
            {onInsert ? "Use Image" : "Saved to Gallery"} <Sparkles className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={() => run()}
            disabled={!canGenerate}
            className="bg-[color:var(--hud)] text-black hover:opacity-90"
          >
            {busy ? "Generating…" : "Generate"}
            <Sparkles className="h-4 w-4" />
          </Button>
        )}
        {stage === "done" && (
          <Button variant="outline" onClick={reset}>
            New Image
          </Button>
        )}
      </div>
    </div>
  );
}

function GeneratedImageCard({
  url,
  prompt,
  provider,
  model,
  onRegenerate,
  onInsert,
  regenerating,
}: {
  url: string;
  prompt: string;
  provider?: string;
  model?: string;
  onRegenerate: () => void;
  onInsert?: (urls: string[]) => void;
  regenerating: boolean;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/40 bg-card transition hover:shadow-[0_0_18px_var(--hud)]">
      <img src={url} alt={prompt} className="w-full" loading="lazy" />
      <div className="flex items-center gap-1 border-t border-border/30 p-2">
        <IconBtn
          label="Download"
          onClick={() => ImageService.downloadImage(url, `lordai-${Date.now()}.png`)}
        >
          <Download className="h-4 w-4" />
        </IconBtn>
        <IconBtn
          label="Copy prompt"
          onClick={() =>
            navigator.clipboard.writeText(prompt).then(() => toast.success("Prompt copied"))
          }
        >
          <Copy className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Regenerate" onClick={onRegenerate} disabled={regenerating}>
          <RefreshCw className={`h-4 w-4 ${regenerating ? "animate-spin" : ""}`} />
        </IconBtn>
        {onInsert && (
          <IconBtn label="Use in chat" onClick={() => onInsert([url])}>
            <Sparkles className="h-4 w-4" />
          </IconBtn>
        )}
      </div>
      {(provider || model) && (
        <div className="border-t border-border/30 px-3 py-1.5 text-[10px] text-muted-foreground">
          {provider ?? "provider"} · {model ?? "model"}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-[color:var(--hud)]/10 hover:text-[color:var(--hud)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
