// Automation Engine (spec §10).
//
// A visual TRIGGER → CONDITION → ACTION builder. Automations are stored in
// server state. "Run now" executes the actions for real through the shared
// execution path. Command triggers can be matched by the Agent Engine so saying
// e.g. "Study Mode" fires the matching automation.

import { registerTool } from "../registry";
import { ok, fail } from "../permissions";
import { getState } from "../state";
import { makeToolContext, disposeToolContext, executeTool } from "../exec";
import { getTool } from "../registry";
import type { Automation, ToolContext, ToolResult } from "../types";

function newId(): string {
  return crypto.randomUUID();
}

function normalizeAction(raw: {
  tool: string;
  params?: Record<string, unknown>;
  label?: string;
}): { tool: string; params: Record<string, unknown>; label?: string } | null {
  const tool = getTool(raw.tool);
  if (!tool) return null;
  return { tool: raw.tool, params: raw.params ?? {}, label: raw.label };
}

export function registerAutomationTools(): void {
  registerTool({
    name: "automation.list",
    category: "automation",
    description: "List all automations with their triggers and actions.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Show my automations."],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      ctx.log({ level: "info", source: "automation", message: "Listed automations." });
      return ok(`${state.automations.length} automation(s).`, { automations: state.automations });
    },
  });

  registerTool({
    name: "automation.create",
    category: "automation",
    description: "Create an automation: WHEN (trigger) THEN (actions).",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "name", type: "string", description: "Automation name", required: true },
      {
        name: "trigger",
        type: "string",
        description: "Trigger type: command | schedule | file-event | sensor-threshold | manual",
        required: true,
      },
      {
        name: "triggerMatch",
        type: "string",
        description: "Phrase/metric the trigger matches",
        required: true,
      },
      {
        name: "actions",
        type: "string[]",
        description: "Tool names to run (each becomes an action)",
        required: true,
      },
    ],
    examples: ["When I say Study Mode, open my study folder and start a timer."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const actionsRaw = Array.isArray(params.actions)
        ? (params.actions as string[])
        : String(params.actions ?? "").split(",");
      const actions = actionsRaw
        .map((a) => normalizeAction({ tool: a.trim() }))
        .filter((a): a is NonNullable<typeof a> => a !== null);
      if (actions.length === 0)
        return fail("No valid actions provided.", { errorCode: "NO_ACTIONS" });
      const automation: Automation = {
        id: newId(),
        name: String(params.name ?? "Automation"),
        enabled: true,
        trigger: {
          type: String(params.trigger ?? "manual") as Automation["trigger"]["type"],
          match: String(params.triggerMatch ?? ""),
        },
        actions,
        createdAt: Date.now(),
        runCount: 0,
      };
      state.automations.push(automation);
      ctx.log({
        level: "warn",
        source: "automation",
        message: `Created automation: ${automation.name}`,
      });
      return ok(`Automation "${automation.name}" created.`, { automation });
    },
  });

  registerTool({
    name: "automation.delete",
    category: "automation",
    description: "Delete an automation by id.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [{ name: "id", type: "string", description: "Automation id", required: true }],
    examples: ["Delete the study mode automation."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const before = state.automations.length;
      state.automations = state.automations.filter((a) => a.id !== params.id);
      if (state.automations.length === before)
        return fail("Automation not found.", { errorCode: "NOT_FOUND" });
      ctx.log({ level: "warn", source: "automation", message: "Deleted automation." });
      return ok("Automation deleted.", { remaining: state.automations.length });
    },
  });

  registerTool({
    name: "automation.run",
    category: "automation",
    description: "Run an automation immediately (explicit 'Run now').",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [{ name: "id", type: "string", description: "Automation id", required: true }],
    examples: ["Run the morning routine now."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const automation = state.automations.find((a) => a.id === params.id);
      if (!automation) return fail("Automation not found.", { errorCode: "NOT_FOUND" });
      const executionId = newId();
      const tctx = makeToolContext(executionId, ctx.userId);
      const results: ToolResult[] = [];
      for (const action of automation.actions) {
        const r = await executeTool(action.tool, action.params, tctx, { forceAllow: true });
        results.push(r);
      }
      disposeToolContext(executionId);
      automation.lastRun = Date.now();
      automation.runCount = (automation.runCount ?? 0) + 1;
      const okCount = results.filter((r) => r.success).length;
      ctx.log({
        level: "success",
        source: "automation",
        message: `Ran "${automation.name}" (${okCount}/${results.length})`,
      });
      return ok(`Ran "${automation.name}": ${okCount}/${results.length} actions succeeded.`, {
        results,
        runCount: automation.runCount,
      });
    },
  });

  registerTool({
    name: "automation.match",
    category: "automation",
    description: "Find automations whose command trigger matches a spoken phrase.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "phrase", type: "string", description: "The phrase Lord heard", required: true },
    ],
    examples: ["Study Mode"],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const phrase = String(params.phrase ?? "").toLowerCase();
      const matches = state.automations.filter(
        (a) =>
          a.enabled &&
          a.trigger.type === "command" &&
          phrase.includes(a.trigger.match.toLowerCase()),
      );
      ctx.log({
        level: "info",
        source: "automation",
        message: `Matched ${matches.length} automation(s) for "${params.phrase}"`,
      });
      return ok(
        matches.length ? `Matched ${matches.length} automation(s).` : "No matching automation.",
        { matches },
      );
    },
  });
}
