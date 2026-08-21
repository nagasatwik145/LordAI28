import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { getApiBaseUrl } from "@/lib/api-config";
import { authenticatedFetch } from "@/lib/authenticated-fetch";
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL_ID } from "@/lib/lord-config";
import { inferImagePromptProfile } from "@/lib/image-prompt";

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
  const [busy, setBusy] = useState(false);
  const [enhancePrompt, setEnhancePrompt] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const effectivePrompt = prompt || initialPrompt || "";
  useEffect(() => {
    if (open) setPrompt(initialPrompt ?? "");
  }, [open, initialPrompt]);

  const generate = async () => {
    if (!effectivePrompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const [width, height] =
        ratio === "16:9" ? [1536, 864] : ratio === "4:3" ? [1024, 768] : [1024, 1024];
      const res = await authenticatedFetch(`${getApiBaseUrl()}/api/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: effectivePrompt,
          quality,
          model,
          conversationId,
          enhancePrompt,
          profile: inferImagePromptProfile(effectivePrompt),
          width,
          height,
        }),
      });
      const body = await res.json();
      if (res.ok && body?.imageUrl) {
        onInsert([body.imageUrl]);
        onClose();
      } else {
        setError(body?.error?.message ?? "Image generation failed. Please try again.");
      }
    } catch {
      setError("Image generation failed. Please try again.");
    } finally {
      setBusy(false);
    }
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
            {error && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-md bg-background/30 px-3 py-2 text-sm"
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
              <button
                onClick={generate}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold"
              >
                {busy ? "Generating..." : "Generate"} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
