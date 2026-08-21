import { createFileRoute } from "@tanstack/react-router";
import { BrowserPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/browser")({
  component: BrowserPanel,
});
