import { createFileRoute } from "@tanstack/react-router";
import { VisionPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/vision")({
  component: VisionPanel,
});
