import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { reloadServerEnv } from "./lib/env.server";
import { logProviderConfigurationDiagnostics } from "./lib/ai-gateway.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

// Re-read the env files on every server start. The dev server otherwise keeps
// the dotenv snapshot taken when the process booted, so a `.env` edited after
// startup left the process holding a STALE provider key — the provider then
// answers 400 "API key not valid." / 401 "Incorrect API key provided." for a
// key that is perfectly valid on disk. Values are also normalized here
// (surrounding quotes and stray whitespace stripped) because those are sent
// verbatim in the auth header and rejected as invalid credentials.
const envReport = reloadServerEnv();

console.info(
  JSON.stringify({
    event: "server_env_loaded",
    message: "ENV LOADED",
    cwd: envReport.cwd,
    files: envReport.files,
    // Safe summaries only: exists / first 8 characters / length.
    changes: envReport.changes.map((change) => ({
      name: change.name,
      action: change.action,
      before: {
        exists: change.before.exists,
        first8: change.before.first8,
        length: change.before.length,
      },
      after: {
        exists: change.after.exists,
        first8: change.after.first8,
        length: change.after.length,
      },
    })),
    providerKeys: envReport.providerKeys,
  }),
);
for (const warning of envReport.warnings) {
  console.warn(`[env] ${warning}`);
}

console.info(
  JSON.stringify({
    event: "server_started",
    message: "SERVER STARTED",
    runtime: "TanStack Start",
    port: process.env.PORT ?? process.env.VITE_PORT ?? process.env.SERVER_PORT ?? 8080,
  }),
);

// Startup diagnostics: Gemini / OpenAI / OpenRouter configured or not.
logProviderConfigurationDiagnostics();

// Image pipeline startup check: verify Cloudflare credentials and per-model
// availability, and print a health report. Runs async so it never blocks boot;
// failures are logged but never crash the server.
void import("./lib/ai/image/image-health")
  .then(({ ensureImageHealth }) => ensureImageHealth())
  .catch((error) => {
    console.error(
      "[image-startup] Cloudflare image health check failed to run:",
      error instanceof Error ? error.message : String(error),
    );
  });

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    if (new URL(request.url).pathname.startsWith("/api/")) {
      console.info(
        JSON.stringify({
          event: "request_received",
          message: "REQUEST RECEIVED",
          method: request.method,
          path: new URL(request.url).pathname,
        }),
      );
    }
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error("ERROR", error);
      console.error("STACK TRACE", error instanceof Error ? error.stack : undefined);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
