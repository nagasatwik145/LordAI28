import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { RiskLevel, ConnectionState, ActivityLevel } from "@/lib/lord/types";

export const ORBITRON: React.CSSProperties = { fontFamily: "'Orbitron', sans-serif" };

export function GlassCard({
  className,
  glow = true,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { glow?: boolean }) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-border bg-card/60 backdrop-blur-xl transition-all duration-300",
        glow && "hover:border-primary/40 hover:shadow-[0_0_30px_rgba(66,133,244,0.18)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  className,
  hint,
}: {
  children: React.ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-baseline justify-between", className)}>
      <h2 className={cn("text-lg font-semibold tracking-wide text-foreground")} style={ORBITRON}>
        {children}
      </h2>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const STATE_COLORS: Record<ConnectionState, string> = {
  online: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]",
  ready: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]",
  offline: "bg-zinc-500",
  "not-connected": "bg-zinc-600",
  count: "bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.8)]",
};

export function StatusDot({ state }: { state: ConnectionState }) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", STATE_COLORS[state] ?? "bg-zinc-500")}
    />
  );
}

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  const map: Record<RiskLevel, string> = {
    low: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    high: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        map[risk],
      )}
    >
      {risk}
    </span>
  );
}

const LEVEL_COLOR: Record<ActivityLevel, string> = {
  info: "text-sky-300",
  success: "text-emerald-300",
  warn: "text-amber-300",
  error: "text-red-300",
  agent: "text-primary",
};

export function activityColor(level: ActivityLevel): string {
  return LEVEL_COLOR[level] ?? "text-muted-foreground";
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin text-primary", className)} />;
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

export function ResultView({
  success,
  message,
  details,
  children,
}: {
  success: boolean;
  message: string;
  details?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-3 rounded-xl border p-3 text-sm",
        success
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
          : "border-red-500/30 bg-red-500/5 text-red-200",
      )}
    >
      <p className="font-medium">
        {success ? "✓ " : "⚠ "}
        {message}
      </p>
      {(details ?? children) && (
        <div className="mt-2 text-xs opacity-90">{details ?? children}</div>
      )}
    </div>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs text-muted-foreground break-all">{children}</span>;
}
