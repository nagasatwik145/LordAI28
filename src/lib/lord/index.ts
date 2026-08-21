// Command Center backend entry point.
//
// Registers every tool module once (idempotent) and exposes status/activity
// snapshots consumed by the API layer and the UI. Tools are registered on
// first access so the module graph stays cheap in dev.

import { getState } from "./state";
import { getLordConfig } from "./config";
import { listTools } from "./registry";
import type { ConnectionStatus, ActivityLogEntry } from "./types";
import { registerPcTools } from "./tools/pc";
import { registerFileTools } from "./tools/files";
import { registerVisionTools } from "./tools/vision";
import { registerOfficeTools } from "./tools/office";
import { registerBrowserTools } from "./tools/browser";
import { registerMobileTools } from "./tools/mobile";
import { registerSmartHomeTools } from "./tools/smart-home";
import { registerAutomationTools } from "./tools/automation";

let registered = false;

export function bootstrapLord(): void {
  if (registered) return;
  registered = true;
  registerPcTools();
  registerFileTools();
  registerVisionTools();
  registerOfficeTools();
  registerBrowserTools();
  registerMobileTools();
  registerSmartHomeTools();
  registerAutomationTools();
}

export const ensureBooted = bootstrapLord;

export function getConnectionStatus(): ConnectionStatus {
  return { ...getState().connections };
}

export function getActivity(limit = 100): ActivityLogEntry[] {
  return getState().activity.slice(0, limit);
}

export function getToolCatalogSummary() {
  return listTools().map((t) => ({ name: t.name, category: t.category, risk: t.risk }));
}

export function isConfigured(): { ai: boolean; esp32: boolean; screen: boolean } {
  const cfg = getLordConfig();
  return {
    ai: Boolean(
      process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
    ),
    esp32: Boolean(cfg.esp32BaseUrl),
    screen: Boolean(cfg.screenCaptureCommand),
  };
}

export * from "./types";
export { planAgentCommand, confirmAgentPlan, abortPlan } from "./agent";
export { executeTool, makeToolContext, disposeToolContext } from "./exec";
export { evaluatePermission } from "./permissions";
export { getTool, listTools, buildToolCatalog } from "./registry";
export { getLordConfig, resetLordConfig } from "./config";
export {
  getState,
  pushActivity,
  clearActivity,
  setConnection,
  setEmergencyStop,
  abortExecution,
} from "./state";
