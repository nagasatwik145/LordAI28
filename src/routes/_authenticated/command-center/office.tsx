import { createFileRoute } from "@tanstack/react-router";
import { OfficePanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/office")({
  component: OfficePanel,
});
