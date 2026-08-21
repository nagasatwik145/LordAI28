import { createFileRoute } from "@tanstack/react-router";
import { AutomationsPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/automations")({
  component: AutomationsPanel,
});
