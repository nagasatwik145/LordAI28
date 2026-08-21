// Centralized Tool Registry (spec §12).
//
// Every LORD capability is registered here as a self-describing tool with a
// name, description, parameters, risk level, and an execution function. The
// Agent Engine discovers tools exclusively through this registry, so new
// capabilities can be added later without touching the core AI/planning logic.

import type { RegisteredTool, ToolDefinition } from "./types";

const registry = new Map<string, RegisteredTool>();

export function registerTool(tool: RegisteredTool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function listTools(): RegisteredTool[] {
  return [...registry.values()];
}

export function listToolsByCategory(category: string): RegisteredTool[] {
  return listTools().filter((t) => t.category === category);
}

/** Compact catalog handed to the planner LLM. */
export function buildToolCatalog(): ToolDefinition[] {
  return listTools().map((t) => ({
    name: t.name,
    category: t.category,
    description: t.description,
    risk: t.risk,
    requiresConfirmation: t.requiresConfirmation,
    parameters: t.parameters,
    examples: t.examples,
  }));
}

/** Human-readable summary used in logs / diagnostics. */
export function toolSummary(): { name: string; risk: string; category: string }[] {
  return listTools().map((t) => ({ name: t.name, risk: t.risk, category: t.category }));
}
