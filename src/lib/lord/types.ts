// Shared types for the LORD Command Center backend.
//
// These types are intentionally provider-agnostic. A `Tool` is a self-contained
// capability (PC control, file ops, vision, office generation, …) that the Agent
// Engine can plan and execute. Every tool declares a `risk` level so the
// permission system can decide whether it may run automatically or must be
// confirmed by Lord first.

export type RiskLevel = "low" | "medium" | "high";

export type ToolCategory =
  | "pc"
  | "files"
  | "vision"
  | "office"
  | "browser"
  | "mobile"
  | "smart-home"
  | "automation"
  | "agent";

/** Structured result returned by every tool — never thrown to the UI raw. */
export interface ToolResult {
  success: boolean;
  message: string;
  /** Arbitrary structured payload (files, device state, analysis, …). */
  data?: Record<string, unknown>;
  /** True when the failure can be retried / is recoverable. */
  recoverable?: boolean;
  /** Optional friendly error code for the UI. */
  errorCode?: string;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
  required?: boolean;
  /** Human-friendly enum for confirmation previews. */
  enum?: readonly string[];
}

export interface ToolDefinition {
  name: string;
  category: ToolCategory;
  description: string;
  risk: RiskLevel;
  /** Whether Lord must explicitly confirm before execution. */
  requiresConfirmation: boolean;
  parameters: ToolParameter[];
  /** Short example invocations shown to the planner LLM. */
  examples?: string[];
}

export interface ToolContext {
  userId?: string;
  /** Aborts the whole execution (e.g. STOP LORD). */
  signal: AbortSignal;
  /** Records an activity-log line. */
  log: (entry: Omit<ActivityLogEntry, "id" | "ts">) => void;
  /** Requests a completion from the configured LLM. */
  llm: (opts: {
    system: string;
    prompt: string;
    mode?: import("@/lib/lord-config").LordMode;
  }) => Promise<{ text: string; provider?: string }>;
  /** Resolved server-side configuration. */
  config: import("./config").LordConfig;
  executionId: string;
}

export type ToolExecutor = (
  params: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

export interface RegisteredTool extends ToolDefinition {
  execute: ToolExecutor;
}

// ---------------------------------------------------------------------------
// Agent planning
// ---------------------------------------------------------------------------

export interface PlanStep {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  risk: RiskLevel;
  intent: string;
  /** Set once executed. */
  status: "pending" | "approved" | "denied" | "running" | "done" | "failed" | "skipped";
  result?: ToolResult;
}

export interface AgentPlan {
  planId: string;
  executionId: string;
  intent: string;
  steps: PlanStep[];
  /** True when one or more steps require Lord's confirmation. */
  needsConfirmation: boolean;
  createdAt: number;
}

export type AgentStatus =
  "planning" | "awaiting-confirmation" | "executing" | "completed" | "aborted" | "error";

export interface AgentExecuteResult {
  status: "completed" | "needs-confirmation" | "error";
  planId?: string;
  intent: string;
  steps: PlanStep[];
  summary?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Activity log + connection status
// ---------------------------------------------------------------------------

export type ActivityLevel = "info" | "success" | "warn" | "error" | "agent";

export interface ActivityLogEntry {
  id: string;
  ts: number;
  level: ActivityLevel;
  message: string;
  source?: string;
}

export type ConnectionState = "online" | "ready" | "offline" | "not-connected" | "count";

export interface ConnectionStatus {
  lordCore: ConnectionState;
  vision: ConnectionState;
  mobile: ConnectionState;
  smartHome: ConnectionState;
  browser: ConnectionState;
  agent: ConnectionState;
  /** Free-form details, e.g. smart-home device count. */
  details?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Mobile pairing
// ---------------------------------------------------------------------------

export interface MobileDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeen: number;
  status: "connected" | "disconnected";
  localIp?: string;
  battery?: number;
  token: string;
}

export interface PairingSession {
  id: string;
  qrPayload: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Smart home / IoT
// ---------------------------------------------------------------------------

export type IoTDeviceKind = "relay" | "light" | "sensor" | "switch" | "fan" | "other";

export interface IoTDevice {
  id: string;
  name: string;
  kind: IoTDeviceKind;
  online: boolean;
  /** Current on/off or 0-100 state. */
  state: string;
  /** Latest sensor readings where available. */
  sensors?: Record<string, number>;
  /** Endpoint used to talk to the device (ESP32). */
  endpoint?: string;
}

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

export type AutomationTriggerType =
  "command" | "schedule" | "file-event" | "sensor-threshold" | "manual";

export interface AutomationAction {
  tool: string;
  params: Record<string, unknown>;
  label?: string;
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    type: AutomationTriggerType;
    /** e.g. the phrase to listen for, or sensor/threshold descriptor. */
    match: string;
    /** For sensor-threshold triggers. */
    condition?: { metric: string; operator: ">" | "<" | "="; value: number };
  };
  actions: AutomationAction[];
  createdAt: number;
  lastRun?: number;
  runCount?: number;
}

// ---------------------------------------------------------------------------
// Generic API envelope
// ---------------------------------------------------------------------------

export interface ApiResult<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  recoverable?: boolean;
  errorCode?: string;
}
