// Server-side configuration for the Command Center.
//
// Everything here is read from environment variables (never hard-coded secrets)
// and falls back to safe defaults so the Command Center still boots without any
// configuration — capabilities that need external services are simply reported
// as "Not Configured" by the UI instead of crashing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureServerEnvLoaded } from "@/lib/env.server";

export interface AllowedApp {
  name: string;
  /** Command run when Lord "launches" the app. Restricted to this allowlist —
   *  arbitrary commands are never accepted from the client. */
  command: string;
  risk: "low" | "medium" | "high";
  description: string;
}

export interface LordConfig {
  /** Directories the File Commander and PC navigation may touch. */
  allowedDirs: string[];
  /** Apps Lord may launch (and the exact command used). */
  allowedApps: AllowedApp[];
  /** Base URL of a local ESP32 / IoT controller. Empty = Not Configured. */
  esp32BaseUrl: string;
  /** When set, screenshots are produced by running this command. */
  screenCaptureCommand: string;
  /** Vision model used for screen/webcam analysis (any configured provider model). */
  visionModel: string;
  /** Where generated office files are written. */
  outputDir: string;
  /** Whether medium-risk actions auto-run (false = always confirm). */
  autoApproveMedium: boolean;
  /** Max automation duration in ms before it is aborted. */
  maxAutomationMs: number;
}

function parseJsonEnv<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function resolveDir(...segments: string[]): string {
  return path.resolve(process.cwd(), ...segments);
}

let cached: LordConfig | null = null;

export function getLordConfig(): LordConfig {
  if (cached) return cached;
  ensureServerEnvLoaded();

  const home = os.homedir?.() ?? process.cwd();

  const defaultAllowedDirs = parseJsonEnv<string[]>("LORD_ALLOWED_DIRS", []);
  const allowedDirs = (
    defaultAllowedDirs.length
      ? defaultAllowedDirs
      : [resolveDir("lord-files"), resolveDir("downloads"), path.join(home, "Downloads")]
  ).map((d) => path.resolve(d));

  const defaultApps: AllowedApp[] = [
    { name: "Calculator", command: "calc", risk: "low", description: "Open the system calculator" },
    { name: "Notepad", command: "notepad", risk: "low", description: "Open Notepad" },
    { name: "Chrome", command: "chrome", risk: "medium", description: "Open Google Chrome" },
    { name: "Terminal", command: "cmd", risk: "medium", description: "Open a terminal" },
  ];
  const allowedApps = parseJsonEnv<AllowedApp[]>("LORD_ALLOWED_APPS", defaultApps).map((a) => ({
    ...a,
    command: a.command,
  }));

  const outputDir = resolveDir("lord-files", "generated");
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    for (const d of allowedDirs) fs.mkdirSync(d, { recursive: true });
  } catch {
    // Best effort — the directory may be read-only; tools report failures.
  }

  cached = {
    allowedDirs,
    allowedApps,
    esp32BaseUrl: process.env.LORD_ESP32_BASE_URL ?? "",
    screenCaptureCommand: process.env.LORD_SCREEN_CAPTURE_CMD ?? "",
    visionModel: process.env.LORD_VISION_MODEL ?? "gemini-3.5-flash",
    outputDir,
    autoApproveMedium: process.env.LORD_AUTO_APPROVE_MEDIUM !== "0",
    maxAutomationMs: Number(process.env.LORD_MAX_AUTOMATION_MS ?? 300000),
  };
  return cached;
}

/** Reset cached config (used by tests / settings reload). */
export function resetLordConfig(): void {
  cached = null;
}
