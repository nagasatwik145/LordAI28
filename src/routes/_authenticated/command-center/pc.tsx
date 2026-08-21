import { createFileRoute } from "@tanstack/react-router";
import { PcPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/pc")({
  component: PcPanel,
});
