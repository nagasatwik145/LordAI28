// Normalize any thrown value into a human-readable string.
//
// UI code must never render a raw object (which shows up as `[object Object]`).
// This helper collapses strings, Errors, and plain objects into a single message,
// falling back to a generic stringified view only when nothing else is usable.

export function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error) {
    return error.message && error.message.length > 0 ? error.message : error.name;
  }

  if (typeof error === "object" && error !== null) {
    const e = error as Record<string, unknown>;
    const candidate =
      typeof e.message === "string"
        ? e.message
        : typeof e.error === "string"
          ? e.error
          : typeof e.details === "string"
            ? e.details
            : undefined;
    if (candidate && candidate.length > 0) return candidate;
    try {
      return JSON.stringify(e, null, 2);
    } catch {
      return "Unknown error";
    }
  }

  return "Unknown error";
}

/** Best-effort extraction of a stable error code from any thrown value. */
export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  if (typeof error === "object" && error !== null) {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/** Best-effort extraction of an actionable hint from any thrown value. */
export function getErrorHint(error: unknown): string | undefined {
  if (error instanceof Error && "hint" in error) {
    const hint = (error as Record<string, unknown>).hint;
    if (typeof hint === "string") return hint;
  }
  if (typeof error === "object" && error !== null) {
    const hint = (error as Record<string, unknown>).hint;
    if (typeof hint === "string") return hint;
  }
  return undefined;
}
