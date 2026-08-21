import { createFileRoute } from "@tanstack/react-router";
import { MobilePanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/mobile")({
  component: MobilePanel,
});
