import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// Server-only environment loading.
//
// Why this file exists: provider keys are read from `process.env` at request
// time, but nothing guaranteed that `.env` had actually been applied to
// `process.env` in this process. In dev the dotenv snapshot is taken once when
// the server boots, so editing `.env` afterwards leaves the running process
// holding STALE key values — the provider then answers 400 "API key not valid."
// (Gemini) or 401 "Incorrect API key provided." (OpenAI) even though the key on
// disk is perfectly valid.
//
// `loadServerEnv()` re-reads the env files on startup, normalizes the values
// (surrounding quotes / stray whitespace are stripped), applies them to
// `process.env`, and reports what changed using key summaries that never
// contain a full secret.

export const PROVIDER_ENV_KEYS = [
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;
export type ProviderEnvKey = (typeof PROVIDER_ENV_KEYS)[number];

/** Client-exposed aliases that must never hold a provider secret. */
const CLIENT_LEAK_ENV_KEYS = [
  "VITE_GEMINI_API_KEY",
  "VITE_OPENAI_API_KEY",
  "VITE_OPENROUTER_API_KEY",
  // Cloudflare image credentials must stay server-side only.
  "VITE_CLOUDFLARE_API_TOKEN",
  "VITE_CLOUDFLARE_ACCOUNT_ID",
] as const;

export interface EnvKeySummary {
  name: string;
  exists: boolean;
  /** First 8 characters only — never the full secret. */
  first8?: string;
  length: number;
}

export interface EnvLoadChange {
  name: string;
  action: "set" | "replaced" | "normalized" | "unchanged";
  before: EnvKeySummary;
  after: EnvKeySummary;
}

export interface EnvLoadReport {
  loadedAt: number;
  cwd: string;
  files: Array<{ file: string; exists: boolean; keys: number }>;
  changes: EnvLoadChange[];
  providerKeys: EnvKeySummary[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

// Strip the two mistakes that silently break provider auth:
//   1. surrounding quotes kept by a loader that does not unquote (`"sk-..."`)
//   2. stray whitespace / newlines from copy-paste or shell heredocs
// Both are sent verbatim in the Authorization header and rejected by the
// provider as an invalid key, which looks identical to a genuinely bad key.
export function normalizeEnvValue(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let value = raw.trim();
  while (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
      continue;
    }
    break;
  }
  // A secret never legitimately contains whitespace; drop CR/LF and inner
  // spaces that come from wrapped copy-paste.
  value = value.replace(/[\r\n\t]/g, "");
  return value;
}

/** Summarize a secret: existence, first 8 characters, and length. Nothing else. */
export function summarizeSecret(value: string | undefined, name = "value"): EnvKeySummary {
  return {
    name,
    exists: !!value && value.length > 0,
    first8: value ? value.slice(0, 8) : undefined,
    length: value?.length ?? 0,
  };
}

export function summarizeEnvKey(name: string): EnvKeySummary {
  return summarizeSecret(process.env[name], name);
}

export function getProviderEnvSummaries(): EnvKeySummary[] {
  return PROVIDER_ENV_KEYS.map((key) => summarizeEnvKey(key));
}

// ---------------------------------------------------------------------------
// .env parsing (no runtime dependency; dotenv is not installed)
// ---------------------------------------------------------------------------

export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    // Strip a trailing inline comment only for unquoted values.
    const quoted = /^(".*"|'.*')$/s.test(value);
    if (!quoted) {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = normalizeEnvValue(value) ?? "";
  }
  return out;
}

function envFileNames(): string[] {
  const mode = process.env.NODE_ENV || "development";
  // Later files win, mirroring the conventional dotenv precedence.
  return [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let lastReport: EnvLoadReport | null = null;

export interface LoadServerEnvOptions {
  /** Directory holding the env files. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * When true (default), a value present in an env file replaces a stale value
   * already sitting in `process.env`. This is what makes a server restart
   * actually pick up an edited `.env`. Disable with LORD_ENV_FILE_OVERRIDE=0.
   */
  override?: boolean;
  /** Force a re-read even if this process already loaded the env files. */
  force?: boolean;
}

export function loadServerEnv(options: LoadServerEnvOptions = {}): EnvLoadReport {
  if (lastReport && !options.force) return lastReport;

  const cwd = options.cwd ?? process.cwd();
  const override =
    options.override ??
    !["0", "false", "no"].includes((process.env.LORD_ENV_FILE_OVERRIDE ?? "1").toLowerCase());

  const files: EnvLoadReport["files"] = [];
  const merged: Record<string, string> = {};

  for (const name of envFileNames()) {
    const file = path.resolve(cwd, name);
    let exists = false;
    let keys = 0;
    try {
      if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
        exists = true;
        const parsed = parseEnvFile(fs.readFileSync(file, "utf8"));
        keys = Object.keys(parsed).length;
        Object.assign(merged, parsed);
      }
    } catch {
      // An unreadable env file must never crash the server; platform-provided
      // env vars (Vercel / Cloudflare) remain the source of truth there.
      exists = false;
    }
    files.push({ file: name, exists, keys });
  }

  const changes: EnvLoadChange[] = [];

  for (const [key, fileValue] of Object.entries(merged)) {
    const before = summarizeSecret(process.env[key], key);
    const current = process.env[key];

    if (current === undefined || current === "") {
      process.env[key] = fileValue;
      changes.push({ name: key, action: "set", before, after: summarizeEnvKey(key) });
      continue;
    }

    const normalizedCurrent = normalizeEnvValue(current);
    if (normalizedCurrent !== current) {
      // Even when the file must not override, a quoted/padded in-process value
      // is always wrong for an HTTP header, so normalize it in place.
      process.env[key] = normalizedCurrent ?? "";
      changes.push({ name: key, action: "normalized", before, after: summarizeEnvKey(key) });
    }

    if (process.env[key] === fileValue) continue;
    if (!override) continue;

    process.env[key] = fileValue;
    changes.push({
      name: key,
      action: "replaced",
      before,
      after: summarizeEnvKey(key),
    });
  }

  // Normalize provider keys even when they come only from the platform env.
  for (const key of PROVIDER_ENV_KEYS) {
    const current = process.env[key];
    if (current === undefined) continue;
    const normalized = normalizeEnvValue(current);
    if (normalized !== current) {
      const before = summarizeSecret(current, key);
      process.env[key] = normalized ?? "";
      changes.push({ name: key, action: "normalized", before, after: summarizeEnvKey(key) });
    }
  }

  const warnings: string[] = [];
  for (const key of CLIENT_LEAK_ENV_KEYS) {
    if (process.env[key]) {
      warnings.push(
        `${key} is set. VITE_* variables are bundled into the browser build — remove it and keep the secret server-only.`,
      );
    }
  }
  for (const key of PROVIDER_ENV_KEYS) {
    const value = process.env[key];
    if (value === undefined) continue;
    if (value.length === 0) warnings.push(`${key} is set but empty.`);
  }

  lastReport = {
    loadedAt: Date.now(),
    cwd,
    files,
    changes,
    providerKeys: getProviderEnvSummaries(),
    warnings,
  };
  return lastReport;
}

/**
 * Idempotent guard used by request-time code paths (serverless invocations may
 * never execute the server entry module).
 */
export function ensureServerEnvLoaded(): EnvLoadReport {
  return lastReport ?? loadServerEnv();
}

/** Force a fresh read of the env files. Used by startup and by diagnostics. */
export function reloadServerEnv(): EnvLoadReport {
  return loadServerEnv({ force: true });
}

export function getEnvLoadReport(): EnvLoadReport | null {
  return lastReport;
}

/** Test-only: drop the cached report so a test can re-run the loader. */
export function resetServerEnvForTests(): void {
  lastReport = null;
}

/**
 * Read a provider API key from `process.env`, normalized exactly as it will be
 * handed to the provider SDK. This is the single source of truth so the SDK and
 * every diagnostic look at the same value.
 */
export function readEnvApiKey(name: string): string | undefined {
  ensureServerEnvLoaded();
  const value = normalizeEnvValue(process.env[name]);
  return value && value.length > 0 ? value : undefined;
}
