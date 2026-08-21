// LORD Agent Brain (spec §11) + Tool-driven execution.
//
// Pipeline:
//   USER → LORD AI → INTENT UNDERSTANDING → TASK PLANNER → TOOL SELECTOR
//   → PERMISSION CHECK → TOOL EXECUTION → RESULT → LORD AI → USER RESPONSE
//
// The engine is NOT hard-coded keyword matching. It asks the LLM to decompose a
// natural-language command into tool calls drawn from the registered Tool
// Registry, then executes each step through the shared permission layer. Low
// risk steps run automatically; medium/high risk steps are held for Lord's
// explicit confirmation (a real, two-phase permission flow).

import { listTools, getTool } from "./registry";
import { evaluatePermission } from "./permissions";
import { makeToolContext, disposeToolContext, executeTool } from "./exec";
import { runLordJson, runLordText } from "./llm";
import { getState, pushActivity } from "./state";
import type {
  AgentExecuteResult,
  AgentPlan,
  PlanStep,
  RiskLevel,
  ToolContext,
  ToolResult,
} from "./types";

interface InternalPlan {
  planId: string;
  executionId: string;
  intent: string;
  steps: PlanStep[];
  userId?: string;
  controller: AbortController;
  createdAt: number;
}

const PLAN_TTL_MS = 10 * 60 * 1000;
const planStore = new Map<string, InternalPlan>();

function buildPlannerPrompt(command: string, catalogJson: string): string {
  return `You are LORD's planning module. Decompose the user's request into a sequence of tool calls using ONLY the tools listed in the catalog.

CATALOG:
${catalogJson}

RULES:
- Prefer the single most appropriate tool per step.
- "files.organize_plan" must precede "files.organize_apply" when organizing.
- For presentations/documents/spreadsheets use office.* tools.
- For web lookups use browser.* tools.
- Keep steps minimal and ordered.
- Each step needs: tool (exact name), params (object), intent (one short phrase).

USER REQUEST:
"""
${command}
"""

Respond ONLY with JSON:
{ "intent": string, "steps": [ { "tool": string, "params": object, "intent": string } ] }`;
}

interface RawPlan {
  intent: string;
  steps: { tool: string; params: Record<string, unknown>; intent: string }[];
}

function mkStep(
  raw: { tool: string; params: Record<string, unknown>; intent: string },
  idx: number,
): PlanStep {
  const tool = getTool(raw.tool);
  const risk: RiskLevel = tool ? tool.risk : "high";
  return {
    id: `step-${idx}-${crypto.randomUUID().slice(0, 6)}`,
    tool: raw.tool,
    params: raw.params ?? {},
    risk,
    intent: raw.intent ?? raw.tool,
    status: "pending",
  };
}

export async function planAgentCommand(
  command: string,
  userId?: string,
): Promise<AgentExecuteResult> {
  const catalog = listTools().map((t) => ({
    name: t.name,
    risk: t.risk,
    description: t.description,
    parameters: t.parameters,
  }));
  const catalogJson = JSON.stringify(catalog, null, 2);

  let raw: RawPlan;
  try {
    raw = await runLordJson<RawPlan>({
      system: "You are LORD's task planner. Output strict JSON only.",
      prompt: buildPlannerPrompt(command, catalogJson),
      schemaHint:
        '{ "intent": string, "steps": [{"tool": string, "params": object, "intent": string}] }',
      mode: "reasoning",
    });
    if (!Array.isArray(raw.steps)) throw new Error("no steps");
  } catch {
    return {
      status: "error",
      intent: "Failed to plan",
      steps: [],
      error: "Lord could not understand the request well enough to plan tool calls.",
    };
  }

  // Drop steps whose tool does not exist.
  const validSteps = raw.steps.filter((s) => getTool(s.tool)).map((s, i) => mkStep(s, i));

  if (validSteps.length === 0) {
    return {
      status: "error",
      intent: raw.intent ?? "Unrecognized request",
      steps: [],
      error: "No applicable tool was found for this request.",
    };
  }

  const executionId = crypto.randomUUID();
  const controller = new AbortController();
  const tctx: ToolContext = makeToolContext(executionId, userId, controller.signal);
  pushActivity({ level: "agent", source: "agent", message: `Planning: ${raw.intent}` });

  const pendingSteps: PlanStep[] = [];
  for (const step of validSteps) {
    if (controller.signal.aborted) {
      step.status = "skipped";
      continue;
    }
    const tool = getTool(step.tool)!;
    const decision = evaluatePermission({
      tool: tool.name,
      risk: tool.risk,
      requiresConfirmation: tool.requiresConfirmation,
      category: tool.category,
    });
    if (decision.decision === "allow") {
      step.status = "running";
      const r = await executeTool(step.tool, step.params, tctx, { userId });
      step.result = r;
      step.status = r.success ? "done" : "failed";
    } else if (decision.decision === "confirm") {
      step.status = "pending";
      pendingSteps.push(step);
    } else {
      step.status = "denied";
      step.result = { success: false, message: decision.reason, errorCode: "DENIED" };
    }
  }

  if (pendingSteps.length === 0) {
    disposeToolContext(executionId, controller.signal);
    const summary = await synthesizeSummary(command, raw.intent, validSteps);
    return { status: "completed", intent: raw.intent, steps: validSteps, summary };
  }

  const planId = crypto.randomUUID();
  const plan: InternalPlan = {
    planId,
    executionId,
    intent: raw.intent,
    steps: validSteps,
    userId,
    controller,
    createdAt: Date.now(),
  };
  planStore.set(planId, plan);
  pushActivity({
    level: "warn",
    source: "security",
    message: `Plan needs confirmation: ${pendingSteps.length} action(s) pending.`,
  });
  return {
    status: "needs-confirmation",
    planId,
    intent: raw.intent,
    steps: validSteps,
  };
}

export async function confirmAgentPlan(
  planId: string,
  approvedStepIds: string[] | "all",
  userId?: string,
): Promise<AgentExecuteResult> {
  const plan = planStore.get(planId);
  if (!plan) {
    return {
      status: "error",
      intent: "Plan expired",
      steps: [],
      error: "This plan is no longer available. Please retry.",
    };
  }
  if (Date.now() - plan.createdAt > PLAN_TTL_MS) {
    planStore.delete(planId);
    return {
      status: "error",
      intent: plan.intent,
      steps: [],
      error: "Plan expired. Please retry.",
    };
  }

  const tctx: ToolContext = makeToolContext(plan.executionId, userId, plan.controller.signal);
  for (const step of plan.steps) {
    if (step.status !== "pending") continue;
    const approved = approvedStepIds === "all" || approvedStepIds.includes(step.id);
    if (!approved) {
      step.status = "skipped";
      continue;
    }
    if (plan.controller.signal.aborted) {
      step.status = "skipped";
      continue;
    }
    step.status = "running";
    const r = await executeTool(step.tool, step.params, tctx, { forceAllow: true, userId });
    step.result = r;
    step.status = r.success ? "done" : "failed";
  }
  disposeToolContext(plan.executionId, plan.controller.signal);
  planStore.delete(planId);

  const summary = await synthesizeSummary(plan.intent, plan.intent, plan.steps);
  return { status: "completed", intent: plan.intent, steps: plan.steps, summary };
}

async function synthesizeSummary(
  command: string,
  intent: string,
  steps: PlanStep[],
): Promise<string> {
  const lines = steps
    .map((s) => `- [${s.status}] ${s.intent} :: ${s.result?.message ?? ""}`)
    .join("\n");
  try {
    const { text } = await runLordText({
      system:
        "You are LORD. Write a short, friendly confirmation of what was just done for the user.",
      prompt: `Request: ${command}\nIntent: ${intent}\nOutcome:\n${lines}\n\nWrite 1-3 sentences summarizing the result for the user.`,
      mode: "fast",
    });
    return text.trim();
  } catch {
    const done = steps.filter((s) => s.status === "done").length;
    return `Completed ${done}/${steps.length} actions for: ${intent}`;
  }
}

/** Stop a specific in-flight execution (used by STOP LORD for a plan). */
export function abortPlan(planId: string): boolean {
  const plan = planStore.get(planId);
  if (!plan) return false;
  plan.controller.abort();
  return true;
}

export type { AgentPlan };
