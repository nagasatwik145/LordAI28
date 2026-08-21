// PC Control module (spec §3).
//
// Exposes safe, permission-gated PC interactions. Crucially, this does NOT allow
// arbitrary command execution: the only commands Lord can launch are the
// allowlisted applications defined in configuration, and every launch is a
// medium-risk, confirmation-required action.
//
// Desktop-only capabilities (typing text, mouse actions, native screenshots,
// media control) are registered so the Agent can reason about them, but they
// return an honest "Not Configured" result on a headless server rather than
// pretending to work.

import { spawn } from "node:child_process";
import os from "node:os";
import { registerTool } from "../registry";
import { ok, fail, notConfigured } from "../permissions";
import { getLordConfig } from "../config";
import { safeReadDir, safeResolve, PathEscapeError } from "../fs-safe";
import type { ToolContext, ToolResult } from "../types";

function runAllowedCommand(command: string, args: string[] = []): Promise<ToolResult> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (err) => {
        resolve(
          fail(`Could not launch "${command}": ${err.message}`, { errorCode: "LAUNCH_FAILED" }),
        );
      });
      // We cannot verify a GUI actually opened on a headless host, so report
      // best-effort success and let Lord know it may need a desktop session.
      resolve(
        ok(`Launched "${command}". Note: on a headless server the window may not be visible.`, {
          command,
        }),
      );
    } catch (err) {
      resolve(
        fail(`Failed to launch "${command}": ${(err as Error).message}`, {
          errorCode: "LAUNCH_ERROR",
        }),
      );
    }
  });
}

export function registerPcTools(): void {
  registerTool({
    name: "pc.system_info",
    category: "pc",
    description: "Read basic system information (OS, CPU, memory, uptime).",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["What are my system specs?", "Read basic system information"],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const info = {
        platform: os.platform(),
        arch: os.arch(),
        release: os.release(),
        hostname: os.hostname(),
        cpuModel: cpus[0]?.model ?? "unknown",
        cpuCores: cpus.length,
        totalMemoryMB: Math.round(totalMem / 1024 / 1024),
        freeMemoryMB: Math.round(freeMem / 1024 / 1024),
        uptimeMinutes: Math.round(os.uptime() / 60),
        nodeVersion: process.version,
      };
      ctx.log({ level: "info", source: "pc", message: "Read system information." });
      return ok("System information retrieved.", { info });
    },
  });

  registerTool({
    name: "pc.list_apps",
    category: "pc",
    description: "List the applications Lord is allowed to launch.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["What apps can you open?"],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const apps = getLordConfig().allowedApps.map((a) => ({
        name: a.name,
        description: a.description,
        risk: a.risk,
      }));
      ctx.log({ level: "info", source: "pc", message: "Listed launchable applications." });
      return ok(`Lord can launch ${apps.length} application(s).`, { apps });
    },
  });

  registerTool({
    name: "pc.launch_app",
    category: "pc",
    description: "Launch an allowed application by name. Only allowlisted apps may be opened.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      {
        name: "app",
        type: "string",
        description: "Name of the application to launch",
        required: true,
      },
    ],
    examples: ["Lord, open Chrome.", "Open Notepad."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const appName = String(params.app ?? "").trim();
      const app = getLordConfig().allowedApps.find(
        (a) => a.name.toLowerCase() === appName.toLowerCase(),
      );
      if (!app) {
        return fail(`"${appName}" is not in the allowed applications list.`, {
          errorCode: "APP_NOT_ALLOWED",
        });
      }
      ctx.log({
        level: "warn",
        source: "pc",
        message: `Launch request: ${app.name} (medium risk).`,
      });
      return runAllowedCommand(app.command);
    },
  });

  registerTool({
    name: "pc.navigate_folder",
    category: "pc",
    description: "List the contents of a folder Lord is permitted to access.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      {
        name: "path",
        type: "string",
        description: "Folder path (within allowed directories)",
        required: true,
      },
    ],
    examples: ["Open my Downloads folder.", "Open my Science project."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const dir = String(params.path ?? ".");
      try {
        const entries = await safeReadDir(dir);
        ctx.log({ level: "info", source: "pc", message: `Listed folder: ${dir}` });
        return ok(`Folder "${dir}" contains ${entries.length} item(s).`, { path: dir, entries });
      } catch (err) {
        if (err instanceof PathEscapeError) {
          return fail("That path is outside the directories Lord is allowed to access.", {
            errorCode: "PATH_DENIED",
          });
        }
        return fail(`Could not read folder: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "pc.screenshot",
    category: "pc",
    description: "Capture the current screen and return the image path.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Take a screenshot."],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const cmd = getLordConfig().screenCaptureCommand;
      if (!cmd) {
        return notConfigured(
          "Screen capture",
          "Set LORD_SCREEN_CAPTURE_CMD (e.g. 'import shot.png' or 'screencapture') to enable native screenshots.",
        );
      }
      const out =
        safeResolve("lord-files/screenshot.png") ?? getLordConfig().outputDir + "/screenshot.png";
      const [c, ...args] = cmd.split(" ");
      const result = await runAllowedCommand(c, [...args, out]);
      ctx.log({ level: "info", source: "pc", message: "Screenshot captured." });
      return result.success ? ok("Screenshot captured.", { path: out }) : result;
    },
  });

  registerTool({
    name: "pc.media_control",
    category: "pc",
    description: "Control media playback (play/pause/next). Requires a configured media command.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      {
        name: "action",
        type: "string",
        description: "play | pause | next | previous | volume",
        required: true,
      },
    ],
    examples: ["Pause the music.", "Next track."],
    async execute(_params, _ctx: ToolContext): Promise<ToolResult> {
      return notConfigured(
        "Media control",
        "Desktop media control requires a local companion; it is not available on this server.",
      );
    },
  });

  registerTool({
    name: "pc.type_text",
    category: "pc",
    description: "Type text into the focused window. Requires local desktop automation.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [{ name: "text", type: "string", description: "Text to type", required: true }],
    examples: ["Open Notepad and type Hello."],
    async execute(_params, _ctx: ToolContext): Promise<ToolResult> {
      return notConfigured(
        "Typing text",
        "Local keyboard automation is not available on this server. Pair Lord Mobile or run a desktop companion for this capability.",
      );
    },
  });

  registerTool({
    name: "pc.keyboard_shortcut",
    category: "pc",
    description: "Send a keyboard shortcut. Requires local desktop automation.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "keys", type: "string", description: "Shortcut, e.g. 'ctrl+c'", required: true },
    ],
    examples: ["Press Ctrl+C."],
    async execute(_params, _ctx: ToolContext): Promise<ToolResult> {
      return notConfigured(
        "Keyboard shortcuts",
        "Local keyboard automation is not available on this server.",
      );
    },
  });

  registerTool({
    name: "pc.mouse_action",
    category: "pc",
    description: "Perform a mouse action. Requires local desktop automation.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      {
        name: "action",
        type: "string",
        description: "click | right-click | double-click | move",
        required: true,
      },
      { name: "x", type: "number", description: "X coordinate (optional)" },
      { name: "y", type: "number", description: "Y coordinate (optional)" },
    ],
    examples: ["Click the button."],
    async execute(_params, _ctx: ToolContext): Promise<ToolResult> {
      return notConfigured(
        "Mouse actions",
        "Local mouse automation is not available on this server.",
      );
    },
  });
}
