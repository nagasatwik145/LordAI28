// File Commander (spec §5).
//
// A real, safe file-management interface operating strictly within the
// configured allowed directories. Organization is two-phase: Lord first
// proposes a plan (low-risk, read-only), then applies it only after Lord
// confirms (medium-risk). Every applied organization pushes an undo entry so
// files are never permanently lost and can be rolled back.

import fs from "node:fs";
import path from "node:path";
import { registerTool } from "../registry";
import { ok, fail, notConfigured } from "../permissions";
import { safeResolve, PathEscapeError, isWithinAllowed } from "../fs-safe";
import { getLordConfig } from "../config";
import type { ToolContext, ToolResult } from "../types";

const CATEGORIES: Record<string, { label: string; ext: string[] }> = {
  Documents: {
    label: "Documents",
    ext: [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "txt",
      "md",
      "csv",
      "odt",
      "ods",
      "odp",
      "rtf",
      "tex",
      "pages",
      "key",
    ],
  },
  Images: {
    label: "Images",
    ext: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "tiff", "heic", "avif"],
  },
  Videos: { label: "Videos", ext: ["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"] },
  Audio: { label: "Audio", ext: ["mp3", "wav", "ogg", "flac", "aac", "m4a", "opus"] },
  Archives: { label: "Archives", ext: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz"] },
  Projects: {
    label: "Projects",
    ext: [
      "js",
      "ts",
      "tsx",
      "jsx",
      "py",
      "java",
      "c",
      "cpp",
      "go",
      "rs",
      "rb",
      "php",
      "html",
      "css",
      "json",
      "yaml",
      "yml",
      "sh",
      "git",
      "ipynb",
      "sql",
    ],
  },
  Other: { label: "Other", ext: [] },
};

function categorize(name: string): string {
  const ext = path.extname(name).replace(".", "").toLowerCase();
  if (!ext) return "Other";
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (cat === "Other") continue;
    if (def.ext.includes(ext)) return cat;
  }
  return "Other";
}

function safeReadDirDetailed(dir: string): fs.Dirent[] {
  const resolved = safeResolve(dir);
  if (!resolved) throw new PathEscapeError();
  return fs.readdirSync(resolved, { withFileTypes: true });
}

// Global undo stack (pinned to globalThis to survive HMR).
const UNDO_KEY = Symbol.for("lord.file-undo");
interface UndoOp {
  id: string;
  label: string;
  moves: { from: string; to: string }[];
}
function undoStack(): UndoOp[] {
  const g = globalThis as unknown as Record<symbol, UndoOp[]>;
  if (!g[UNDO_KEY]) g[UNDO_KEY] = [];
  return g[UNDO_KEY];
}

export function registerFileTools(): void {
  registerTool({
    name: "files.browse",
    category: "files",
    description: "Browse files and folders within the allowed directories.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "path", type: "string", description: "Directory to browse", required: false },
    ],
    examples: ["Browse my files.", "Show me the Downloads folder."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const dir = String(params.path ?? ".");
      try {
        const entries = safeReadDirDetailed(dir).map((e) => ({
          name: e.name,
          isDir: e.isDirectory(),
        }));
        ctx.log({ level: "info", source: "files", message: `Browsed ${dir}` });
        return ok(`"${dir}" has ${entries.length} item(s).`, { path: dir, entries });
      } catch (err) {
        if (err instanceof PathEscapeError)
          return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
        return fail(`Cannot browse: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "files.search",
    category: "files",
    description: "Search for files by name within allowed directories.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      {
        name: "query",
        type: "string",
        description: "File name or pattern (substring match)",
        required: true,
      },
      { name: "path", type: "string", description: "Directory to search in", required: false },
    ],
    examples: ["Find my resume pdf.", "Search for photosynthesis notes."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const query = String(params.query ?? "").toLowerCase();
      const root = safeResolve(String(params.path ?? ".")) ?? getFirstAllowed();
      if (!root) return fail("No allowed directory available.", { errorCode: "NO_DIR" });
      const hits: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 6 || hits.length > 200) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (e.name.toLowerCase().includes(query)) {
            hits.push(path.join(dir, e.name));
          }
          if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
        }
      };
      walk(root, 0);
      ctx.log({
        level: "info",
        source: "files",
        message: `Search "${query}" → ${hits.length} hits`,
      });
      return ok(`Found ${hits.length} matching file(s).`, { query, hits });
    },
  });

  registerTool({
    name: "files.preview",
    category: "files",
    description: "Preview the contents of a text file (first portion).",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "path", type: "string", description: "File to preview", required: true },
      { name: "bytes", type: "number", description: "Max bytes to read", required: false },
    ],
    examples: ["Preview my notes.txt."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const file = safeResolve(String(params.path ?? ""));
      if (!file) return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
      try {
        const stat = fs.statSync(file);
        if (stat.isDirectory())
          return fail("That is a folder, not a file.", { errorCode: "IS_DIR" });
        const limit = Math.min(Number(params.bytes ?? 4000), 20000);
        const content = fs.readFileSync(file, "utf8").slice(0, limit);
        ctx.log({ level: "info", source: "files", message: `Previewed ${path.basename(file)}` });
        return ok("File preview ready.", { path: file, content, truncated: stat.size > limit });
      } catch (err) {
        return fail(`Cannot preview: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "files.create_folder",
    category: "files",
    description: "Create a new folder within allowed directories.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "path", type: "string", description: "Folder path to create", required: true },
    ],
    examples: ["Create a folder called Science Project."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const folder = safeResolve(String(params.path ?? ""));
      if (!folder) return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
      try {
        fs.mkdirSync(folder, { recursive: true });
        ctx.log({
          level: "warn",
          source: "files",
          message: `Created folder ${path.basename(folder)}`,
        });
        return ok(`Folder "${path.basename(folder)}" created.`, { path: folder });
      } catch (err) {
        return fail(`Cannot create folder: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "files.rename",
    category: "files",
    description: "Rename a file or folder.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "path", type: "string", description: "Existing path", required: true },
      { name: "newName", type: "string", description: "New name (not full path)", required: true },
    ],
    examples: ["Rename report.pdf to final_report.pdf."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const src = safeResolve(String(params.path ?? ""));
      if (!src) return fail("Source outside allowed directories.", { errorCode: "PATH_DENIED" });
      const dir = path.dirname(src);
      const dst = path.join(dir, String(params.newName ?? ""));
      if (!isWithinAllowed(dst))
        return fail("New name escapes allowed directories.", { errorCode: "PATH_DENIED" });
      try {
        fs.renameSync(src, dst);
        ctx.log({ level: "warn", source: "files", message: `Renamed ${path.basename(src)}` });
        return ok(`Renamed to "${params.newName}".`, { from: src, to: dst });
      } catch (err) {
        return fail(`Cannot rename: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "files.move",
    category: "files",
    description: "Move a file or folder to a new location (within allowed directories).",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "path", type: "string", description: "Source path", required: true },
      { name: "destination", type: "string", description: "Destination directory", required: true },
    ],
    examples: ["Move photo.png to Images."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const src = safeResolve(String(params.path ?? ""));
      const dstDir = safeResolve(String(params.destination ?? ""));
      if (!src || !dstDir)
        return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
      const dst = path.join(dstDir, path.basename(src));
      try {
        fs.renameSync(src, dst);
        ctx.log({ level: "warn", source: "files", message: `Moved ${path.basename(src)}` });
        return ok(`Moved to "${params.destination}".`, { from: src, to: dst });
      } catch (err) {
        return fail(`Cannot move: ${(err as Error).message}`, { errorCode: "FS_ERROR" });
      }
    },
  });

  registerTool({
    name: "files.organize_plan",
    category: "files",
    description:
      "Propose an organization plan for a folder (Documents/Images/Videos/Audio/Archives/Projects/Other) without moving anything.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "path", type: "string", description: "Folder to organize", required: true },
    ],
    examples: ["Organize my Downloads folder."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const dir = safeResolve(String(params.path ?? ""));
      if (!dir) return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
      try {
        const files = fs.readdirSync(dir).filter((f) => {
          try {
            return fs.statSync(path.join(dir, f)).isFile();
          } catch {
            return false;
          }
        });
        const plan: Record<string, string[]> = {};
        for (const cat of Object.keys(CATEGORIES)) plan[cat] = [];
        for (const f of files) plan[categorize(f)].push(f);
        const total = files.length;
        const movable = total - plan.Other.length;
        ctx.log({
          level: "info",
          source: "files",
          message: `Planned organization of ${dir} (${movable} files)`,
        });
        return ok(`Proposed organization for ${total} file(s).`, {
          path: dir,
          plan,
          movableCount: movable,
        });
      } catch (err) {
        return fail(`Cannot plan organization: ${(err as Error).message}`, {
          errorCode: "FS_ERROR",
        });
      }
    },
  });

  registerTool({
    name: "files.organize_apply",
    category: "files",
    description:
      "Apply a previously proposed organization: move files into category subfolders and record an undo entry.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "path", type: "string", description: "Folder to organize", required: true },
    ],
    examples: ["Apply the Downloads organization."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const dir = safeResolve(String(params.path ?? ""));
      if (!dir) return fail("Path outside allowed directories.", { errorCode: "PATH_DENIED" });
      try {
        const files = fs.readdirSync(dir).filter((f) => {
          try {
            return fs.statSync(path.join(dir, f)).isFile();
          } catch {
            return false;
          }
        });
        const moves: { from: string; to: string }[] = [];
        for (const f of files) {
          const cat = categorize(f);
          if (cat === "Other") continue;
          const destDir = path.join(dir, CATEGORIES[cat].label);
          fs.mkdirSync(destDir, { recursive: true });
          const from = path.join(dir, f);
          const to = path.join(destDir, f);
          fs.renameSync(from, to);
          moves.push({ from, to });
        }
        undoStack().unshift({
          id: crypto.randomUUID(),
          label: `Organized ${path.basename(dir)}`,
          moves,
        });
        ctx.log({
          level: "warn",
          source: "files",
          message: `Applied organization: ${moves.length} files moved`,
        });
        return ok(`Organization complete. ${moves.length} file(s) moved.`, { moved: moves.length });
      } catch (err) {
        return fail(`Cannot apply organization: ${(err as Error).message}`, {
          errorCode: "FS_ERROR",
        });
      }
    },
  });

  registerTool({
    name: "files.undo",
    category: "files",
    description: "Undo the most recent organization operation.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [],
    examples: ["Undo the last organization."],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const op = undoStack().shift();
      if (!op) return fail("Nothing to undo.", { errorCode: "NO_UNDO" });
      let restored = 0;
      for (const m of op.moves) {
        try {
          fs.renameSync(m.to, m.from);
          restored++;
        } catch {
          // best effort
        }
      }
      ctx.log({
        level: "warn",
        source: "files",
        message: `Undid organization (${restored} files)`,
      });
      return ok(`Undid "${op.label}". ${restored} file(s) restored.`, { restored });
    },
  });
}

function getFirstAllowed(): string | null {
  return getLordConfig().allowedDirs[0] ?? null;
}
