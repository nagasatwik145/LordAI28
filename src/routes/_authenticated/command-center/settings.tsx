import { createFileRoute } from "@tanstack/react-router";
import { SettingsPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/settings")({
  component: SettingsPanel,
});
