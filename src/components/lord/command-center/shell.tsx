import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Monitor,
  Eye,
  FolderOpen,
  FileBarChart,
  Globe,
  Smartphone,
  Home,
  Workflow,
  Settings,
  TerminalSquare,
  ShieldAlert,
  Circle,
} from "lucide-react";
import { GlassCard, SectionTitle, StatusDot, ORBITRON, Spinner, activityColor } from "./ui";
import { useStatus, useActivity, useAgent, useStop, type AgentResult } from "./api";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/command-center", label: "Dashboard", icon: Home },
  { to: "/command-center/pc", label: "PC Control", icon: Monitor },
  { to: "/command-center/vision", label: "Vision", icon: Eye },
  { to: "/command-center/files", label: "File Commander", icon: FolderOpen },
  { to: "/command-center/office", label: "Office", icon: FileBarChart },
  { to: "/command-center/browser", label: "Browser", icon: Globe },
  { to: "/command-center/mobile", label: "Mobile", icon: Smartphone },
  { to: "/command-center/smart-home", label: "Smart Home", icon: Home },
  { to: "/command-center/automations", label: "Automations", icon: Workflow },
  { to: "/command-center/settings", label: "Settings", icon: Settings },
] as const;

function Nav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active =
          pathname === item.to || (item.to !== "/command-center" && pathname.startsWith(item.to));
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all",
              active
                ? "border-primary/50 bg-primary/10 text-foreground shadow-[0_0_18px_rgba(66,133,244,0.25)]"
                : "border-transparent text-muted-foreground hover:border-border hover:bg-card/50",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectionStatusCard() {
  const { data, isLoading } = useStatus();
  const conn = data?.connections ?? {};
  const items: Array<[string, string]> = [
    ["LORD CORE", conn.lordCore ?? "offline"],
    ["VISION", conn.vision ?? "offline"],
    ["MOBILE", conn.mobile ?? "not-connected"],
    ["SMART HOME", conn.smartHome ?? "offline"],
    ["BROWSER", conn.browser ?? "offline"],
    ["AGENT", conn.agent ?? "offline"],
  ];
  return (
    <GlassCard className="p-4">
      <SectionTitle hint={isLoading ? "…" : "live"}>CONNECTION STATUS</SectionTitle>
      <div className="space-y-2">
        {items.map(([label, state]) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <StatusDot state={state as never} />
              {label}
            </span>
            <span className="text-xs uppercase tracking-wide text-foreground/80">
              {state.replace("-", " ")}
            </span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ActivityCard() {
  const { data } = useActivity();
  const [open, setOpen] = React.useState(true);
  const entries = data?.activity ?? [];
  return (
    <GlassCard className="flex min-h-[260px] flex-col p-4">
      <div className="flex items-center justify-between">
        <SectionTitle>CURRENT ACTIVITY</SectionTitle>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? "hide" : "show"}
        </button>
      </div>
      {open && (
        <div className="mt-1 flex-1 space-y-1 overflow-y-auto pr-1 font-mono text-xs">
          {entries.length === 0 && <p className="text-muted-foreground">Lord is standing by…</p>}
          {entries.map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="text-muted-foreground/60">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={activityColor(e.level as never)}>{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function CommandBar() {
  const [cmd, setCmd] = React.useState("");
  const agent = useAgent();
  const [confirmPlan, setConfirmPlan] = React.useState<{
    planId: string;
    steps: AgentResult["steps"];
  } | null>(null);

  React.useEffect(() => {
    if (agent.data?.status === "needs-confirmation" && agent.data.planId) {
      setConfirmPlan({ planId: agent.data.planId, steps: agent.data.steps });
    }
  }, [agent.data]);

  const run = () => {
    if (!cmd.trim()) return;
    agent.mutate({ command: cmd });
  };

  return (
    <GlassCard glow={false} className="p-3">
      <div className="flex items-center gap-2">
        <TerminalSquare className="h-5 w-5 text-primary" />
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder='Command Lord… e.g. "Create a 6-slide presentation about photosynthesis and open it."'
          className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          onClick={run}
          disabled={agent.isPending}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/80 disabled:opacity-50"
        >
          {agent.isPending ? <Spinner /> : "Execute"}
        </button>
      </div>

      {agent.isError && (
        <p className="mt-2 text-xs text-red-300">{(agent.error as Error).message}</p>
      )}

      {confirmPlan && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-amber-200">REVIEW & CONFIRM</p>
          <p className="text-xs text-muted-foreground">
            The following action(s) require your confirmation:
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {confirmPlan.steps
              .filter((s) => s.status === "pending")
              .map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <Circle className="h-2 w-2 fill-amber-400 text-amber-400" />
                  <span className="text-amber-100">{s.intent}</span>
                  <span className="text-xs text-muted-foreground">({s.tool})</span>
                </li>
              ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                agent.mutate({ planId: confirmPlan.planId, approvedStepIds: "all" });
              }}
              disabled={agent.isPending}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
            >
              Confirm & Execute
            </button>
            <button
              onClick={() => setConfirmPlan(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {agent.data?.status === "completed" && agent.data.summary && (
        <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-100">
          {agent.data.summary}
        </div>
      )}
      {agent.data?.status === "error" && agent.data.error && (
        <p className="mt-2 text-xs text-red-300">{agent.data.error}</p>
      )}
    </GlassCard>
  );
}

function EmergencyStop() {
  const stop = useStop();
  const [active, setActive] = React.useState(false);
  return (
    <button
      onClick={() => {
        const next = !active;
        setActive(next);
        stop.mutate({ resume: !next });
      }}
      className={cn(
        "flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-all",
        active
          ? "border-red-500/40 bg-red-500/10 text-red-300 shadow-[0_0_22px_rgba(239,68,68,0.35)]"
          : "border-red-500/30 text-red-300/90 hover:bg-red-500/10",
      )}
      style={ORBITRON}
    >
      <ShieldAlert className="h-4 w-4" />
      {active ? "STOP LORD • ACTIVE" : "STOP LORD"}
    </button>
  );
}

export function CommandCenterShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-widest text-foreground" style={ORBITRON}>
              LORD COMMAND CENTER
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Everything under your command.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
              SYSTEM READY
            </span>
            <EmergencyStop />
          </div>
        </header>

        <div className="mt-4">
          <CommandBar />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[180px_1fr_300px]">
          <aside>
            <Nav />
          </aside>
          <main className="min-w-0">{children}</main>
          <aside className="space-y-4">
            <ConnectionStatusCard />
            <ActivityCard />
          </aside>
        </div>
      </div>
    </div>
  );
}
