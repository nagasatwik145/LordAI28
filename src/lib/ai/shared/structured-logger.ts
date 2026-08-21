// Structured JSON logger shared by the AI subsystems.
//
// Every log line is a single JSON object so it can be ingested by a log
// pipeline without regex parsing. The logger is deliberately dependency-free
// and isomorphic (browser + server) so both the image pipeline and any future
// chat module can use exactly one implementation.
//
// SECURITY: values are passed through `redact()` before being serialized.
// Secrets (tokens, keys, authorization headers) are never emitted, and prompts
// are reduced to a length so user content never reaches the logs.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values must never be logged, matched case-insensitively. */
const SECRET_KEY_PATTERN =
  /(token|secret|password|authorization|api[-_]?key|credential|cookie|session)/i;

/** Keys that hold user content and are replaced by a length summary. */
const CONTENT_KEY_PATTERN = /^(prompt|enhancedPrompt|negativePrompt|editInstruction|text)$/;

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (CONTENT_KEY_PATTERN.test(key) && typeof value === "string") {
    return `[redacted length=${value.length}]`;
  }
  if (typeof value === "string" && value.startsWith("data:")) {
    return `[data-url bytes=${value.length}]`;
  }
  return value;
}

/** Shallow-redact a log payload. Nested objects are redacted one level deep. */
export function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    const redacted = redactValue(key, value);
    if (redacted !== value) {
      out[key] = redacted;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue;
        nested[k] = redactValue(k, v);
      }
      out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export interface StructuredLogger {
  debug(event: string, payload?: Record<string, unknown>): void;
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
  /** Derive a logger that always includes the given fields. */
  child(fields: Record<string, unknown>): StructuredLogger;
}

function resolveLevel(): LogLevel {
  const raw = typeof process !== "undefined" ? process.env?.LORD_LOG_LEVEL : undefined;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  const production = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  return production ? "info" : "debug";
}

/**
 * Create a namespaced structured logger.
 *
 * @param scope short subsystem name, emitted as `scope` on every line.
 * @param base fields merged into every line (e.g. `{ provider: "cloudflare" }`).
 */
export function createStructuredLogger(
  scope: string,
  base: Record<string, unknown> = {},
): StructuredLogger {
  const minimum = LEVEL_ORDER[resolveLevel()];

  const emit = (level: LogLevel, event: string, payload?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < minimum) return;
    const line = JSON.stringify({
      level,
      scope,
      event,
      ...redact({ ...base, ...(payload ?? {}) }),
      timestamp: Date.now(),
    });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };

  return {
    debug: (event, payload) => emit("debug", event, payload),
    info: (event, payload) => emit("info", event, payload),
    warn: (event, payload) => emit("warn", event, payload),
    error: (event, payload) => emit("error", event, payload),
    child: (fields) => createStructuredLogger(scope, { ...base, ...fields }),
  };
}
