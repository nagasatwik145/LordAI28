import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CommandCenterShell } from "@/components/lord/command-center/shell";

export const Route = createFileRoute("/_authenticated/command-center")({
  component: CommandCenterLayout,
});

function CommandCenterLayout() {
  return (
    <CommandCenterShell>
      <Outlet />
    </CommandCenterShell>
  );
}
