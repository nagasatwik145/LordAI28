import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import ImageGenerator from "@/components/lord/ImageGenerator";

/**
 * Image generation entry point used by the chat. It is a thin modal shell around
 * the shared {@link ImageGenerator} so the chat and the dedicated Images page use
 * the exact same controls, provider logic, and result handling (no duplication).
 */
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
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-[#031426]"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-border/30 bg-[#031426] px-6 py-4">
              <h3 className="text-lg font-semibold text-white">Generate Images</h3>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-2 text-muted-foreground hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ImageGenerator
              variant="modal"
              conversationId={conversationId}
              onInsert={(urls) => {
                onInsert(urls);
                onClose();
              }}
              initialPrompt={initialPrompt}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
