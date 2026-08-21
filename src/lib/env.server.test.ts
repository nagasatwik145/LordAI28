import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadServerEnv,
  normalizeEnvValue,
  parseEnvFile,
  resetServerEnvForTests,
  summarizeSecret,
} from "./env.server";

const PROVIDER_KEYS = ["GEMINI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const;

describe("normalizeEnvValue", () => {
  it("strips the surrounding quotes that providers reject as an invalid key", () => {
    expect(normalizeEnvValue('"sk-or-v1-abc"')).toBe("sk-or-v1-abc");
    expect(normalizeEnvValue("'AIzaSomething'")).toBe("AIzaSomething");
  });

  it("strips whitespace and newlines from wrapped copy-paste", () => {
    expect(normalizeEnvValue("  sk-proj-abc  ")).toBe("sk-proj-abc");
    expect(normalizeEnvValue("sk-proj-\nabc\r\n")).toBe("sk-proj-abc");
  });

  it("leaves a clean value untouched", () => {
    expect(normalizeEnvValue("sk-or-v1-clean")).toBe("sk-or-v1-clean");
    expect(normalizeEnvValue(undefined)).toBeUndefined();
  });
});

describe("summarizeSecret", () => {
  it("exposes only existence, the first 8 characters and the length", () => {
    const summary = summarizeSecret("sk-proj-super-secret-value", "OPENAI_API_KEY");
    expect(summary).toEqual({
      name: "OPENAI_API_KEY",
      exists: true,
      first8: "sk-proj-",
      length: 26,
    });
    // The full secret must never appear anywhere in the summary.
    expect(JSON.stringify(summary)).not.toContain("super-secret-value");
  });

  it("reports a missing value without inventing a prefix", () => {
    expect(summarizeSecret(undefined, "GEMINI_API_KEY")).toEqual({
      name: "GEMINI_API_KEY",
      exists: false,
      first8: undefined,
      length: 0,
    });
  });
});

describe("parseEnvFile", () => {
  it("parses quoted, exported and commented entries", () => {
    const parsed = parseEnvFile(
      [
        "# comment",
        'GEMINI_API_KEY="AQ.quoted"',
        "export OPENAI_API_KEY='sk-single'",
        "OPENROUTER_API_KEY=sk-or-plain # trailing comment",
        "EMPTY=",
      ].join("\n"),
    );
    expect(parsed.GEMINI_API_KEY).toBe("AQ.quoted");
    expect(parsed.OPENAI_API_KEY).toBe("sk-single");
    expect(parsed.OPENROUTER_API_KEY).toBe("sk-or-plain");
    expect(parsed.EMPTY).toBe("");
  });
});

describe("loadServerEnv", () => {
  let dir: string;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lord-env-"));
    for (const key of PROVIDER_KEYS) saved.set(key, process.env[key]);
    resetServerEnvForTests();
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    resetServerEnvForTests();
  });

  it("replaces a stale in-process key with the current value from .env", () => {
    // This is the failure that produced Gemini 400 "API key not valid." and
    // OpenAI 401 "Incorrect API key provided.": the process was still holding
    // the key snapshot taken before `.env` was updated.
    process.env.GEMINI_API_KEY = "AI123456-stale-placeholder-value";
    process.env.OPENAI_API_KEY = "sk-0e3c1-stale-placeholder-value";
    fs.writeFileSync(
      path.join(dir, ".env"),
      ['GEMINI_API_KEY="AQ.fresh-valid-key"', 'OPENAI_API_KEY="sk-proj-fresh-valid-key"'].join(
        "\n",
      ),
    );

    const report = loadServerEnv({ cwd: dir, force: true });

    expect(process.env.GEMINI_API_KEY).toBe("AQ.fresh-valid-key");
    expect(process.env.OPENAI_API_KEY).toBe("sk-proj-fresh-valid-key");
    const replaced = report.changes.filter((c) => c.action === "replaced").map((c) => c.name);
    expect(replaced).toContain("GEMINI_API_KEY");
    expect(replaced).toContain("OPENAI_API_KEY");
    // Reports carry summaries only.
    expect(JSON.stringify(report)).not.toContain("fresh-valid-key");
  });

  it("normalizes a quoted value already present in process.env", () => {
    process.env.OPENROUTER_API_KEY = '"sk-or-v1-quoted"';
    const report = loadServerEnv({ cwd: dir, force: true });
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-v1-quoted");
    expect(report.changes.some((c) => c.action === "normalized")).toBe(true);
  });

  it("does not override platform env when override is disabled", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-platform";
    fs.writeFileSync(path.join(dir, ".env"), "OPENROUTER_API_KEY=sk-or-file");
    loadServerEnv({ cwd: dir, force: true, override: false });
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-platform");
  });

  it("is a no-op when no env file exists (deployed platforms)", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-platform";
    const report = loadServerEnv({ cwd: dir, force: true });
    expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-platform");
    expect(report.files.every((f) => !f.exists)).toBe(true);
  });

  it("warns when a provider secret is exposed through a VITE_ variable", () => {
    process.env.VITE_OPENROUTER_API_KEY = "sk-or-leaked";
    try {
      const report = loadServerEnv({ cwd: dir, force: true });
      expect(report.warnings.join(" ")).toContain("VITE_OPENROUTER_API_KEY");
    } finally {
      delete process.env.VITE_OPENROUTER_API_KEY;
    }
  });
});
