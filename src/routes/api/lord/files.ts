import { createFileRoute } from "@tanstack/react-router";
import { requireSupabaseRequestAuth } from "@/integrations/supabase/auth-middleware";
import { callTool } from "@/lib/lord/api";

const ACTION_TOOL: Record<string, string> = {
  browse: "files.browse",
  search: "files.search",
  preview: "files.preview",
  create_folder: "files.create_folder",
  rename: "files.rename",
  move: "files.move",
  plan: "files.organize_plan",
  organize: "files.organize_apply",
  undo: "files.undo",
};

export const Route = createFileRoute("/api/lord/files")({
  server: {
    middleware: [requireSupabaseRequestAuth],
    handlers: {
      GET: async ({ request, context }) => {
        const url = new URL(request.url);
        const userId = (context as { userId?: string }).userId;
        return Response.json(
          await callTool("files.browse", { path: url.searchParams.get("path") ?? "." }, userId),
        );
      },
      POST: async ({ request, context }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const userId = (context as { userId?: string }).userId;
        const tool = ACTION_TOOL[String(body.action ?? "browse")] ?? "files.browse";
        return Response.json(await callTool(tool, body, userId));
      },
    },
  },
});
