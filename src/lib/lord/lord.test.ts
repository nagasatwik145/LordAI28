import { describe, it, expect, beforeAll } from "vitest";
import { evaluatePermission } from "./permissions";
import { safeResolve, isWithinAllowed } from "./fs-safe";
import {
  bootstrapLord,
  makeToolContext,
  executeTool,
  setEmergencyStop,
  getState,
  clearActivity,
} from "./index";
import { getLordConfig } from "./config";

beforeAll(() => {
  bootstrapLord();
});

describe("permission system", () => {
  it("allows low-risk automatically", () => {
    const d = evaluatePermission({
      tool: "x",
      risk: "low",
      requiresConfirmation: false,
      category: "pc",
    });
    expect(d.decision).toBe("allow");
  });

  it("always confirms high-risk", () => {
    const d = evaluatePermission({
      tool: "x",
      risk: "high",
      requiresConfirmation: false,
      category: "files",
    });
    expect(d.decision).toBe("confirm");
  });

  it("confirms medium-risk when auto-approve is off", () => {
    const prev = getLordConfig().autoApproveMedium;
    getLordConfig().autoApproveMedium = false;
    const d = evaluatePermission({
      tool: "x",
      risk: "medium",
      requiresConfirmation: false,
      category: "files",
    });
    getLordConfig().autoApproveMedium = prev;
    expect(d.decision).toBe("confirm");
  });

  it("denies when emergency stop is active", () => {
    setEmergencyStop(true);
    const d = evaluatePermission({
      tool: "x",
      risk: "low",
      requiresConfirmation: false,
      category: "pc",
    });
    expect(d.decision).toBe("deny");
    setEmergencyStop(false);
  });
});

describe("safe filesystem", () => {
  it("rejects paths outside allowed directories", () => {
    const evil = safeResolve("../../../../etc/passwd");
    expect(evil).toBeNull();
    expect(isWithinAllowed("/etc/passwd")).toBe(false);
  });

  it("resolves paths inside allowed directories", () => {
    const allowed = getLordConfig().allowedDirs[0];
    const r = safeResolve("lord-files/test.txt");
    expect(r).not.toBeNull();
    expect(r!.startsWith(allowed)).toBe(true);
  });
});

describe("tool execution", () => {
  it("executes a low-risk tool end to end", async () => {
    const ctx = makeToolContext("test-exec-1");
    const result = await executeTool("pc.system_info", {}, ctx);
    expect(result.success).toBe(true);
    expect(result.data?.info).toBeDefined();
  });

  it("reports unknown tools", async () => {
    const ctx = makeToolContext("test-exec-2");
    const result = await executeTool("does.not.exist", {}, ctx);
    expect(result.success).toBe(false);
  });

  it("records activity log entries", async () => {
    clearActivity();
    const ctx = makeToolContext("test-exec-3");
    await executeTool("pc.system_info", {}, ctx);
    expect(getState().activity.length).toBeGreaterThan(0);
  });
});
