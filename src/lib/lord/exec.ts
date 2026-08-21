// Shared tool execution with the permission layer applied.
//
// Both the Agent Engine and the Automation engine execute tools through this
// single path so the risk model (auto / confirm / deny) and the activity log
// are enforced identically everywhere.

import { getTool } from "./registry";
import { evaluatePermission } from "./permissions";
import { getState, pushActivity, registerExecution, endExecution } from "./state";
import { runLordText } from "./llm";
import { getLordConfig } from "./config";
import type { ToolContext, ToolResult } from "./types";

export interface ExecuteOptions {
  /** Skip the confirmation requirement (used by "Run now" and approved plans). */
  forceAllow?: boolean;
  userId?: string;
}

export function makeToolContext(
  executionId: string,
  userId?: string,
  externalSignal?: AbortSignal,
): ToolContext {
  let controller: AbortController;
  if (externalSignal) {
    controller = {
      abort: () => {},
      signal: externalSignal,
      aborted: externalSignal.aborted,
    } as AbortController;
  } else {
    controller = registerExecution(executionId);
  }
  return {
    userId,
    signal: controller.signal,
    executionId,
    config: getLordConfig(),
    log: (e) => pushActivity(e),
    llm: runLordText,
  };
}

export function disposeToolContext(executionId: string, externalSignal?: AbortSignal): void {
  if (!externalSignal) endExecution(executionId);
}

/** Execute a single tool through the permission layer. */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  ctx: ToolContext,
  opts: ExecuteOptions = {},
): Promise<ToolResult> {
  const tool = getTool(toolName);
  if (!tool) {
    return {
      success: false,
      message: `Unknown tool: ${toolName}`,
      recoverable: false,
      errorCode: "UNKNOWN_TOOL",
    };
  }

  const decision = evaluatePermission({
    tool: tool.name,
    risk: tool.risk,
    requiresConfirmation: tool.requiresConfirmation,
    category: tool.category,
  });

  if (decision.decision === "deny") {
    pushActivity({
      level: "error",
      source: "security",
      message: `Denied: ${tool.name} — ${decision.reason}`,
    });
    return { success: false, message: decision.reason, recoverable: false, errorCode: "DENIED" };
  }

  if (decision.decision === "confirm" && !opts.forceAllow) {
    // Caller must confirm separately. Report the requirement rather than running.
    return {
      success: false,
      message: `Confirmation required: ${decision.reason}`,
      recoverable: true,
      errorCode: "NEEDS_CONFIRMATION",
    };
  }

  if (ctx.signal.aborted) {
    return {
      success: false,
      message: "Execution aborted (STOP LORD).",
      recoverable: false,
      errorCode: "ABORTED",
    };
  }

  pushActivity({
    level: "agent",
    source: tool.category,
    message: `Executing ${tool.name}…`,
  });

  try {
    const result = await tool.execute(params, ctx);
    pushActivity({
      level: result.success ? "success" : "error",
      source: tool.category,
      message: result.success
        ? `${tool.name}: ${result.message}`
        : `${tool.name} failed: ${result.message}`,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushActivity({
      level: "error",
      source: tool.category,
      message: `${tool.name} threw: ${message}`,
    });
    return { success: false, message, recoverable: true, errorCode: "TOOL_THREW" };
  }
}

/** Force-abort any in-flight execution (used by STOP LORD at the API layer too). */
export function abortExecutionById(id: string): boolean {
  const state = getState();
  const controller = state.executions.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
