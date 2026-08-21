// Safe filesystem helpers shared by PC Control and File Commander.
//
// All paths are resolved and validated to stay within the configured allowed
// directories. Path traversal outside the allowed roots is rejected — this is
// the core of the "do not allow unrestricted filesystem access" requirement.

import fs from "node:fs";
import path from "node:path";
import { getLordConfig } from "./config";

export function isWithinAllowed(target: string): boolean {
  const resolved = path.resolve(target);
  const allowed = getLordConfig().allowedDirs.map((d) => path.resolve(d));
  return allowed.some((dir) => resolved === dir || resolved.startsWith(dir + path.sep));
}

/** Resolve a user-supplied path against the allowed roots. Returns null if it
 *  escapes every allowed directory. */
export function safeResolve(userPath: string): string | null {
  if (path.isAbsolute(userPath)) {
    return isWithinAllowed(userPath) ? path.resolve(userPath) : null;
  }
  // Treat relative paths as relative to the first allowed dir (the workspace root).
  const base = getLordConfig().allowedDirs[0];
  const resolved = path.resolve(base, userPath);
  return isWithinAllowed(resolved) ? resolved : null;
}

export class PathEscapeError extends Error {
  constructor() {
    super("Path is outside the allowed directories.");
    this.name = "PathEscapeError";
  }
}

export async function safeReadDir(dir: string): Promise<string[]> {
  const resolved = safeResolve(dir) ?? (isWithinAllowed(dir) ? path.resolve(dir) : null);
  if (!resolved) throw new PathEscapeError();
  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? e.name + "/" : e.name));
}

export async function safeStat(p: string): Promise<fs.Stats | null> {
  const resolved = safeResolve(p);
  if (!resolved) return null;
  try {
    return await fs.promises.stat(resolved);
  } catch {
    return null;
  }
}

export function ensureAllowedDir(p: string): string {
  const resolved = safeResolve(p);
  if (!resolved) throw new PathEscapeError();
  return resolved;
}
