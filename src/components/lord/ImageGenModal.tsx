import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X, LogIn, CheckCircle2, AlertTriangle } from "lucide-react";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/lord-config";
import { inferImagePromptProfile } from "@/lib/image-prompt";
import {
  generateImageWithGateway,
  ImageGatewayError,
  checkImageProviderHealth,
  type ImageGatewaySelection,
} from "@/lib/image-gateway-client";
import { puterProvider } from "@/lib/providers/puter-provider";
import { persistGeneratedImage } from "@/lib/image-persist-client";
import { listImageProviders } from "@/lib/image-provider-registry";
import type { UnifiedImageResult, ImageGenerationDiagnostics } from "@/lib/providers/types";

type PuterStatus = "unknown" | "authenticated" | "unauthenticated" | "unavailable";
type Stage = "idle" | "preparing" | "generating" | "saving" | "done" | "error";

const PROVIDER_LABEL: Record<string, string> = {
  puter: "Puter",
  cloudflare: "Cloudflare",
  openrouter: "OpenRouter",
};

export default function ImageGenModal({
  open,
  onClose,
  onInsert,
  conversationId,
  initialPrompt,
}: {
  open: boolean;
  onClose: () => void;
  onInsert: (urls: string[]) => void;
  conversationId?: string | null;
  initialPrompt?: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState("high");
  const [model, setModel] = useState(DEFAULT_IMAGE_MODEL_ID);
  const [ratio, setRatio] = useState("1:1");
  const [provider, setProvider] = useState<ImageGatewaySelection>("auto");
  const [busy, setBusy] = useState(false);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [puterStatus, setPuterStatus] = useState<PuterStatus>("unknown");
  const [signingIn, setSigningIn] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<UnifiedImageResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<ImageGenerationDiagnostics | null>(null);
  const effectivePrompt = prompt || initialPrompt || "";

  useEffect(() => {
    if (open) {
      setPrompt(initialPrompt ?? "");
      setError(null);
      setErrorHint(null);
      setResult(null);
      setDiagnostics(null);
      setStage("idle");
      void refreshPuterStatus();
    }
  }, [open, initialPrompt]);

  async function refreshPuterStatus() {
    try {
      const health = await checkImageProviderHealth();
      const p = health.puter;
      setPuterStatus(
        p.available ? (p.authenticated ? "authenticated" : "unauthenticated") : "unavailable",
      );
    } catch {
      setPuterStatus("unavailable");
    }
  }

  const showPuterLogin =
    (provider === "puter" || provider === "auto") && puterStatus === "unauthenticated";

  const signInToPuter = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await puterProvider.signIn();
      await refreshPuterStatus();
    } catch {
      setError("Could not sign in to Puter. Please try again.");
    } finally {
      setSigningIn(false);
    }
  };

  const requestedProviderLabel =
    provider === "auto" ? "auto (Puter → OpenRouter)" : (PROVIDER_LABEL[provider] ?? provider);

  const generate = async () => {
    if (!effectivePrompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    setErrorHint(null);
    setResult(null);
    setDiagnostics(null);
    setStage("preparing");
    try {
      const [width, height] =
        ratio === "16:9" ? [1536, 864] : ratio === "4:3" ? [1024, 768] : [1024, 1024];
      setStage("generating");
      const generated = await generateImageWithGateway({
        prompt: effectivePrompt,
        provider,
        model: provider === "puter" || provider === "auto" ? undefined : model,
        quality: quality as "fast" | "balanced" | "high",
        aspectRatio: ratio,
        count: 1,
        enhancePrompt,
        profile: inferImagePromptProfile(effectivePrompt),
        conversationId,
      });

      // Only client-generated (Puter) images need explicit persistence;
      // server providers already saved to the gallery inside /api/images.
      if (generated.provider === "Puter") {
        setStage("saving");
        await persistGeneratedImage({
          images: generated.images,
          prompt: effectivePrompt,
          model: generated.model,
          provider: "Puter",
          width,
          height,
          aspectRatio: ratio,
          conversationId,
          generationTimeMs: generated.generationTime,
          estimatedCost: generated.cost,
        });
      }

      setResult(generated);
      setDiagnostics(generated.diagnostics ?? null);
      setStage("done");
    } catch (e) {
      setStage("error");
      if (e instanceof ImageGatewayError && e.authRequired) {
        setError("Sign in with Puter to use free image generation.");
        await refreshPuterStatus();
      } else {
        const message =
          e instanceof Error && e.message
            ? e.message
            : "Image generation failed. Please try again.";
        const hint = (e as ImageGatewayError & { hint?: string })?.hint;
        setError(message);
        setErrorHint(hint ?? null);
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setDiagnostics(null);
    setStage("idle");
    setError(null);
    setErrorHint(null);
  };

  const finish = () => {
    if (result) onInsert(result.images);
    onClose();
  };

  const stageLabel: Record<Stage, string> = {
    idle: "",
    preparing: "Preparing your request…",
    generating: `Generating with ${requestedProviderLabel}…`,
    saving: "Saving to your gallery…",
    done: "Done",
    error: "Failed",
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        >
          <motion.div
            initial={{ y: 24 }}
            animate={{ y: 0 }}
            exit={{ y: 24 }}
            className="w-full max-w-2xl rounded-2xl bg-[#031426] p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Generate Images</h3>
              <button onClick={onClose} aria-label="Close" className="p-2">
                {" "}
                <X className="h-5 w-5" />{" "}
              </button>
            </div>
            <textarea
              value={effectivePrompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image..."
              className="w-full rounded-md p-3 bg-background/30 text-white"
              rows={4}
            />

            {showPuterLogin && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-cyan-500/40 bg-cyan-500/10 p-3">
                <p className="text-sm text-cyan-100">
                  Sign in with Puter to use free image generation.
                </p>
                <button
                  onClick={signInToPuter}
                  disabled={signingIn}
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-white"
                >
                  <LogIn className="h-4 w-4" /> {signingIn ? "Signing in…" : "Sign in"}
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>{error}</p>
                  {errorHint && <p className="mt-1 text-red-300/80">{errorHint}</p>}
                </div>
              </div>
            )}

            {busy && (
              <div className="mt-3 flex items-center gap-3 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                <div className="text-sm text-cyan-100">
                  <p>{stageLabel[stage]}</p>
                  <p className="text-cyan-300/70">Requested provider: {requestedProviderLabel}</p>
                </div>
              </div>
            )}

            {stage === "done" && result && (
              <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" /> Image generated
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-emerald-200/90">
                  <dt>Provider</dt>
                  <dd>{diagnostics?.provider ?? result.provider}</dd>
                  <dt>Model</dt>
                  <dd>{diagnostics?.modelLabel ?? result.model}</dd>
                  {diagnostics?.fallbackUsed && (
                    <>
                      <dt>Fallback</dt>
                      <dd>
                        {diagnostics?.fallbackProvider ?? "yes"} (
                        {diagnostics?.fallbackModel ?? "another model"})
                      </dd>
                    </>
                  )}
                  <dt>Generation time</dt>
                  <dd>{diagnostics?.generationTimeMs ?? result.generationTime} ms</dd>
                  {diagnostics?.retryCount != null && diagnostics.retryCount > 0 && (
                    <>
                      <dt>Retries</dt>
                      <dd>{diagnostics.retryCount}</dd>
                    </>
                  )}
                  {diagnostics?.persistenceWarning && (
                    <>
                      <dt>Gallery</dt>
                      <dd className="text-amber-300">not saved (schema missing)</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as ImageGatewaySelection)}
                className="rounded-md bg-background/30 px-3 py-2 text-sm"
                aria-label="Provider"
              >
                <option value="auto">Auto</option>
                {listImageProviders().map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {p.authRequired ? " (sign-in)" : ""}
                  </option>
                ))}
              </select>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-md bg-background/30 px-3 py-2 text-sm"
                disabled={provider === "puter"}
              >
                {IMAGE_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-xs text-cyan-100">
                <input
                  type="checkbox"
                  checked={enhancePrompt}
                  onChange={(event) => setEnhancePrompt(event.target.checked)}
                />{" "}
                Enhance prompt
              </label>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                className="rounded-md bg-background/30 px-3 py-2 text-sm"
              >
                <option>1:1</option>
                <option>16:9</option>
                <option>4:3</option>
              </select>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="rounded-md bg-background/30 px-3 py-2 text-sm"
              >
                <option value="high">High</option>
                <option value="balanced">Balanced</option>
                <option value="fast">Fast</option>
              </select>
              {stage === "done" ? (
                <button
                  onClick={finish}
                  className="ml-auto inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold"
                >
                  Use Image <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={generate}
                  disabled={busy}
                  className="ml-auto inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold"
                >
                  {busy ? "Generating..." : "Generate"} <ArrowRight className="h-4 w-4" />
                </button>
              )}
              {stage === "done" && (
                <button onClick={reset} className="rounded-md bg-background/30 px-3 py-2 text-sm">
                  New image
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
