import { createFileRoute } from "@tanstack/react-router";
import { FilesPanel } from "@/components/lord/command-center/panels";

export const Route = createFileRoute("/_authenticated/command-center/files")({
  component: FilesPanel,
});
