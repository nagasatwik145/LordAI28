import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { safeResolve } from "@/lib/lord/fs-safe";

// Streams a generated/opened file back to the browser for download/preview.
// Path is resolved through the same allowed-directory guard as every other
// filesystem tool, so this cannot be used to exfiltrate arbitrary files.
export const Route = createFileRoute("/api/lord/file")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("path") ?? "";
        const resolved = safeResolve(target);
        if (!resolved) {
          return Response.json({ error: "Path not allowed" }, { status: 403 });
        }
        try {
          const stat = statSync(resolved);
          if (!stat.isFile()) return Response.json({ error: "Not a file" }, { status: 400 });
          const buf = readFileSync(resolved);
          const name = path.basename(resolved);
          return new Response(new Uint8Array(buf), {
            status: 200,
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
              "Cache-Control": "no-store",
            },
          });
        } catch {
          return Response.json({ error: "File not found" }, { status: 404 });
        }
      },
    },
  },
});
