// Shared API handlers for the Command Center backend.
//
// These wrap the Agent Engine and Tool Registry so the thin file-based API
// routes stay tiny. Authentication reuses the existing Supabase request
// middleware (same as /api/chat) so the Command Center inherits the app's
// existing auth rather than inventing its own.

import {
  bootstrapLord,
  makeToolContext,
  disposeToolContext,
  executeTool,
  planAgentCommand,
  confirmAgentPlan,
  setEmergencyStop,
  getState,
} from "./index";
import type { ApiResult, AgentExecuteResult } from "./types";

export function ensureBooted(): void {
  bootstrapLord();
}

export async function callTool(
  tool: string,
  params: Record<string, unknown> = {},
  userId?: string,
): Promise<ApiResult> {
  ensureBooted();
  const executionId = crypto.randomUUID();
  const ctx = makeToolContext(executionId, userId);
  const result = await executeTool(tool, params ?? {}, ctx, {});
  disposeToolContext(executionId);
  return {
    success: result.success,
    message: result.message,
    data: result.data,
    error: result.success ? undefined : result.message,
    recoverable: result.recoverable,
    errorCode: result.errorCode,
  };
}

export async function runAgent(
  body: { command?: string; planId?: string; approvedStepIds?: string[] | "all" },
  userId?: string,
): Promise<AgentExecuteResult> {
  ensureBooted();
  if (body.planId) {
    return confirmAgentPlan(body.planId, body.approvedStepIds ?? "all", userId);
  }
  return planAgentCommand(body.command ?? "", userId);
}

export function stopAll(): { stopped: number } {
  const state = getState();
  setEmergencyStop(true);
  let stopped = 0;
  for (const [id, controller] of state.executions) {
    controller.abort();
    stopped++;
    void id;
  }
  return { stopped };
}

export function resumeAll(): void {
  setEmergencyStop(false);
}
