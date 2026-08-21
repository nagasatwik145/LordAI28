import { createFileRoute } from "@tanstack/react-router";
import { SmartHomePanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/smart-home")({
  component: SmartHomePanel,
});
