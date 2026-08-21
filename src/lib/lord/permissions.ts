// Permission system for the Command Center.
//
// Risk model (see spec §13):
//   LOW    — open calculator, screenshot, create presentation, read a file.
//            Executes automatically.
//   MEDIUM — move/rename/organize files, control IoT devices. Confirmation or
//            preview depending on the action (configurable via autoApproveMedium).
//   HIGH   — delete files, send messages, submit forms, change account
//            settings, arbitrary system commands. Always require explicit
//            confirmation.
//
// Every tool declares its own risk + `requiresConfirmation`. The permission
// layer reconciles those with the global emergency stop and the connection
// state to produce a final decision.

import type { RiskLevel, ToolResult } from "./types";
import { getState } from "./state";
import { getLordConfig } from "./config";

export type PermissionDecision = "allow" | "confirm" | "deny";

export interface PermissionInput {
  tool: string;
  risk: RiskLevel;
  requiresConfirmation: boolean;
  category: string;
}

export interface PermissionOutput {
  decision: PermissionDecision;
  reason: string;
}

export function evaluatePermission(input: PermissionInput): PermissionOutput {
  const state = getState();
  if (state.emergencyStop) {
    return { decision: "deny", reason: "Emergency stop is active (STOP LORD)." };
  }

  // High-risk is always a confirmation, never silent.
  if (input.risk === "high") {
    return { decision: "confirm", reason: "High-risk action requires explicit confirmation." };
  }

  if (input.requiresConfirmation) {
    return { decision: "confirm", reason: "This tool requires explicit confirmation." };
  }

  if (input.risk === "medium") {
    const config = getLordConfig();
    if (config.autoApproveMedium) {
      return { decision: "allow", reason: "Medium-risk action auto-approved by configuration." };
    }
    return { decision: "confirm", reason: "Medium-risk action requires confirmation." };
  }

  return { decision: "allow", reason: "Low-risk action approved automatically." };
}

// ---------------------------------------------------------------------------
// Structured result helpers (spec §20)
// ---------------------------------------------------------------------------

export function ok(message: string, data?: Record<string, unknown>): ToolResult {
  return { success: true, message, ...(data ? { data } : {}) };
}

export function fail(
  message: string,
  opts: { recoverable?: boolean; errorCode?: string; data?: Record<string, unknown> } = {},
): ToolResult {
  return {
    success: false,
    message,
    recoverable: opts.recoverable ?? true,
    errorCode: opts.errorCode,
    ...(opts.data ? { data: opts.data } : {}),
  };
}

/** Used when a capability needs an external service that is not configured. */
export function notConfigured(capability: string, hint?: string): ToolResult {
  return {
    success: false,
    message: `${capability} is not configured. ${hint ?? ""}`.trim(),
    recoverable: false,
    errorCode: "NOT_CONFIGURED",
  };
}
