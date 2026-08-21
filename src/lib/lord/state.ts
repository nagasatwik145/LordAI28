// In-memory server state for the Command Center.
//
// A single module-level singleton (pinned to globalThis so it survives dev HMR)
// holds the activity log, live connection status, mobile pairing, IoT devices,
// automations, the emergency-stop flag, and per-execution abort controllers.
//
// NOTE: this is process-local state. On serverless deploys it would reset per
// cold start; for the local/dev server (the documented run target) it persists
// across requests, which is exactly what the live activity log and connection
// panel need.

import type {
  ActivityLogEntry,
  Automation,
  ConnectionStatus,
  IoTDevice,
  MobileDevice,
  PairingSession,
} from "./types";

interface LordState {
  activity: ActivityLogEntry[];
  connections: ConnectionStatus;
  mobile: {
    pairing: PairingSession | null;
    devices: MobileDevice[];
  };
  iot: IoTDevice[];
  automations: Automation[];
  /** Global emergency stop. When true, no tool may start. */
  emergencyStop: boolean;
  /** executionId -> AbortController for in-flight agent runs. */
  executions: Map<string, AbortController>;
  /** In-flight plans awaiting confirmation (planId -> plan). */
  pendingPlans: Map<string, unknown>;
}

const KEY = Symbol.for("lord.command-center.state");

function freshState(): LordState {
  return {
    activity: [],
    connections: {
      lordCore: "online",
      vision: "ready",
      mobile: "not-connected",
      smartHome: "offline",
      browser: "ready",
      agent: "ready",
      details: {},
    },
    mobile: { pairing: null, devices: [] },
    iot: [],
    automations: [],
    emergencyStop: false,
    executions: new Map(),
    pendingPlans: new Map(),
  };
}

export function getState(): LordState {
  const g = globalThis as unknown as Record<symbol, LordState>;
  if (!g[KEY]) g[KEY] = freshState();
  return g[KEY];
}

const MAX_ACTIVITY = 500;

export function pushActivity(entry: Omit<ActivityLogEntry, "id" | "ts">): ActivityLogEntry {
  const state = getState();
  const full: ActivityLogEntry = {
    ...entry,
    id: crypto.randomUUID(),
    ts: Date.now(),
  };
  state.activity.unshift(full);
  if (state.activity.length > MAX_ACTIVITY) {
    state.activity.length = MAX_ACTIVITY;
  }
  return full;
}

export function clearActivity(): void {
  getState().activity = [];
}

export function setConnection(patch: Partial<ConnectionStatus>): void {
  const state = getState();
  state.connections = { ...state.connections, ...patch };
}

export function setEmergencyStop(value: boolean): void {
  const state = getState();
  state.emergencyStop = value;
  if (value) {
    for (const controller of state.executions.values()) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
    pushActivity({
      level: "error",
      source: "security",
      message: "STOP LORD activated — all pending execution aborted.",
    });
  } else {
    pushActivity({
      level: "success",
      source: "security",
      message: "STOP LORD cleared. Operations resumed.",
    });
  }
}

export function registerExecution(id: string): AbortController {
  const state = getState();
  const controller = new AbortController();
  state.executions.set(id, controller);
  return controller;
}

export function endExecution(id: string): void {
  getState().executions.delete(id);
}

export function abortExecution(id: string): boolean {
  const state = getState();
  const controller = state.executions.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
