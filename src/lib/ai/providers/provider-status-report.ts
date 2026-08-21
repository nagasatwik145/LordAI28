// User-facing provider status report (Phase 8).
//
// Instead of a bare `AI_RATE_LIMITED` the user gets an honest, actionable panel:
//
//   All configured AI providers are temporarily unavailable.
//
//   Provider Status
//
//   ❌ Gemini      Quota exceeded
//   ❌ OpenAI      Quota exceeded
//   ❌ OpenRouter  Daily limit reached
//   🟢 Cloudflare  Available
//
//   Automatically retrying when providers recover.
//
// This module is isomorphic: it imports only `provider-types` (which has no
// imports at all), so the same formatter runs on the server to build the error
// body and in the browser to render it.

import {
  FAILURE_KIND_USER_TEXT,
  type ProviderFailureKind,
  type ProviderHealth,
  type ProviderId,
  type ProviderLabel,
} from "./provider-types";

export const STATUS_ICON = {
  available: "🟢",
  degraded: "🟡",
  unavailable: "❌",
} as const;

export type ProviderStatusIcon = (typeof STATUS_ICON)[keyof typeof STATUS_ICON];

export interface ProviderStatusLine {
  provider: ProviderLabel;
  providerId: ProviderId;
  icon: ProviderStatusIcon;
  /** Short status text shown in the table, e.g. "Quota exceeded". */
  text: string;
  available: boolean;
  configured: boolean;
  /** ISO timestamp when the provider becomes eligible again, when known. */
  retryAt: string | null;
  retryInMs: number | null;
  /** Human phrasing of `retryInMs`, e.g. "12m". */
  retryInLabel: string | null;
  failureKind: ProviderFailureKind | null;
}

export interface ProviderStatusReport {
  /** True when at least one configured provider can serve a request. */
  anyAvailable: boolean;
  lines: ProviderStatusLine[];
  /** Soonest moment any provider is expected back, in ms. */
  nextRetryInMs: number | null;
  headline: string;
}

const HEADLINE_ALL_DOWN = "All configured AI providers are temporarily unavailable.";
const HEADLINE_SOME_UP = "Some AI providers are temporarily unavailable.";
const FOOTER = "Automatically retrying when providers recover.";
const TABLE_TITLE = "Provider Status";

/** Status text for one provider, mirroring the wording users expect. */
export function describeProviderStatus(health: ProviderHealth): {
  icon: ProviderStatusIcon;
  text: string;
  available: boolean;
} {
  if (!health.configured) {
    return { icon: STATUS_ICON.unavailable, text: "Not configured", available: false };
  }
  if (health.disabledUntilConfigChange) {
    return { icon: STATUS_ICON.unavailable, text: "Configuration error", available: false };
  }
  if (health.cooldownRemainingMs > 0) {
    const kind = health.lastFailureKind;
    if (kind === "quota_exceeded") {
      return { icon: STATUS_ICON.unavailable, text: "Quota exceeded", available: false };
    }
    const text = kind ? FAILURE_KIND_USER_TEXT[kind] : "Temporarily unavailable";
    return { icon: STATUS_ICON.unavailable, text, available: false };
  }
  if (health.status === "degraded") {
    return { icon: STATUS_ICON.degraded, text: "Recovering", available: true };
  }
  return { icon: STATUS_ICON.available, text: "Available", available: true };
}

/** Compact duration: "45s", "12m", "1h 5m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function buildProviderStatusReport(
  snapshots: readonly ProviderHealth[],
  options: { now?: number; includeUnconfigured?: boolean } = {},
): ProviderStatusReport {
  const now = options.now ?? Date.now();
  const includeUnconfigured = options.includeUnconfigured ?? false;

  const relevant = snapshots.filter((health) => includeUnconfigured || health.configured);
  const source = relevant.length > 0 ? relevant : snapshots;

  const lines: ProviderStatusLine[] = source.map((health) => {
    const { icon, text, available } = describeProviderStatus(health);
    const retryInMs = health.cooldownRemainingMs > 0 ? health.cooldownRemainingMs : null;
    return {
      provider: health.provider,
      providerId: health.providerId,
      icon,
      text,
      available,
      configured: health.configured,
      retryAt: retryInMs !== null ? new Date(now + retryInMs).toISOString() : null,
      retryInMs,
      retryInLabel: retryInMs !== null ? formatDuration(retryInMs) : null,
      failureKind: health.lastFailureKind,
    };
  });

  const anyAvailable = lines.some((line) => line.available);
  const retryCandidates = lines
    .map((line) => line.retryInMs)
    .filter((value): value is number => value !== null);
  const nextRetryInMs = retryCandidates.length > 0 ? Math.min(...retryCandidates) : null;

  return {
    anyAvailable,
    lines,
    nextRetryInMs,
    headline: anyAvailable ? HEADLINE_SOME_UP : HEADLINE_ALL_DOWN,
  };
}

/**
 * Render the report as the plain-text panel shown to the user. The table is
 * column-aligned so it stays readable in a chat bubble or a toast.
 */
export function formatProviderStatusMessage(
  report: ProviderStatusReport,
  options: { requestId?: string; includeFooter?: boolean; explanation?: string } = {},
): string {
  const includeFooter = options.includeFooter ?? true;
  const width = report.lines.reduce((max, line) => Math.max(max, line.provider.length), 0) + 2;

  const table = report.lines.map(
    (line) => `${line.icon} ${line.provider.padEnd(width)}${line.text}`,
  );

  const blocks: string[] = [report.headline];
  if (options.explanation) blocks.push(options.explanation);
  blocks.push([TABLE_TITLE, "", ...table].join("\n"));

  if (includeFooter) {
    const footer =
      report.nextRetryInMs !== null
        ? `${FOOTER} Next attempt in about ${formatDuration(report.nextRetryInMs)}.`
        : FOOTER;
    blocks.push(footer);
  }

  if (options.requestId) {
    blocks.push(`Request ID: ${shortRequestId(options.requestId)}`);
  }

  return blocks.join("\n\n");
}

export function shortRequestId(requestId: string): string {
  return requestId ? requestId.slice(0, 8).toUpperCase() : "";
}

/**
 * One-line variant for toasts and log lines:
 * "All AI providers are unavailable (Gemini: Quota exceeded; OpenAI: Rate limited)."
 */
export function formatProviderStatusSummary(report: ProviderStatusReport): string {
  const unavailable = report.lines.filter((line) => !line.available);
  if (unavailable.length === 0) return "All AI providers are available.";
  const detail = unavailable.map((line) => `${line.provider}: ${line.text}`).join("; ");
  return `${report.headline} (${detail})`;
}
