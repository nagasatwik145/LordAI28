import { createFileRoute } from "@tanstack/react-router";
import { DashboardCards } from "@/components/lord/command-center/panels";
import { SectionTitle } from "@/components/lord/command-center/ui";

export const Route = createFileRoute("/_authenticated/command-center/")({
  component: Dashboard,
});

function Dashboard() {
  return (
    <div>
      <SectionTitle hint="everything under your command">COMMAND DECK</SectionTitle>
      <DashboardCards />
    </div>
  );
}
