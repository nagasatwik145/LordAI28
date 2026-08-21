// Browser Agent (spec §7).
//
// Real, server-side web automation: open/navigate to a URL, search the web,
// read a page, and summarize it with the LLM. Consequential actions (submitting
// forms, purchases, sending messages, deleting content) are registered as
// HIGH-risk and are refused by default with an honest message — they must never
// run without explicit, deliberate confirmation.

import { registerTool } from "../registry";
import { ok, fail } from "../permissions";
import { runLordText } from "../llm";
import type { ToolContext, ToolResult } from "../types";

function stripHtml(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(
  url: string,
  signal: AbortSignal,
): Promise<{ text: string; title: string }> {
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    headers: { "User-Agent": "LordAI-CommandCenter/1.0 (+https://lordai.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.trim() ?? url;
  const text = stripHtml(html).slice(0, 8000);
  return { text, title };
}

export function registerBrowserTools(): void {
  registerTool({
    name: "browser.open",
    category: "browser",
    description: "Open a URL and read its text content.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [{ name: "url", type: "string", description: "Full URL to open", required: true }],
    examples: ["Open the NCERT website.", "Go to example.com."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const url = String(params.url ?? "");
      if (!/^https?:\/\//i.test(url))
        return fail("Only http(s) URLs are allowed.", { errorCode: "BAD_URL" });
      try {
        ctx.log({ level: "info", source: "browser", message: `Opening ${url}` });
        const { text, title } = await fetchText(url, ctx.signal);
        return ok(`Opened "${title}".`, { url, title, text });
      } catch (err) {
        return fail(`Could not open page: ${(err as Error).message}`, { errorCode: "FETCH_ERROR" });
      }
    },
  });

  registerTool({
    name: "browser.search",
    category: "browser",
    description: "Search the web for a query and return the top results.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [{ name: "query", type: "string", description: "Search query", required: true }],
    examples: ["Search for information about photosynthesis."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const query = String(params.query ?? "");
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      try {
        ctx.log({ level: "info", source: "browser", message: `Searching: ${query}` });
        const { text } = await fetchText(searchUrl, ctx.signal);
        // crude result extraction
        const results: { title: string; url: string; snippet: string }[] = [];
        const blocks = text
          .split("IPv6")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const b of blocks.slice(0, 8)) {
          const urlMatch = b.match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            results.push({ title: b.slice(0, 80), url: urlMatch[0], snippet: b.slice(0, 200) });
          }
        }
        if (results.length === 0) {
          return ok("Search returned no extractable results.", { query, results: [] });
        }
        return ok(`Found ${results.length} result(s) for "${query}".`, { query, results });
      } catch (err) {
        return fail(`Search failed: ${(err as Error).message}`, { errorCode: "SEARCH_ERROR" });
      }
    },
  });

  registerTool({
    name: "browser.summarize",
    category: "browser",
    description: "Open a URL and produce an AI summary of its content.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "url", type: "string", description: "URL to summarize", required: true },
      {
        name: "focus",
        type: "string",
        description: "Optional focus for the summary",
        required: false,
      },
    ],
    examples: ["Summarize this webpage."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const url = String(params.url ?? "");
      if (!/^https?:\/\//i.test(url))
        return fail("Only http(s) URLs are allowed.", { errorCode: "BAD_URL" });
      try {
        ctx.log({ level: "info", source: "browser", message: `Summarizing ${url}` });
        const { text, title } = await fetchText(url, ctx.signal);
        const { text: summary } = await runLordText({
          system: "You summarize web pages clearly and concisely for Lord's user.",
          prompt: `Summarize the following page${params.focus ? ` with focus on: ${params.focus}` : ""}.\n\nTitle: ${title}\n\nContent:\n${text.slice(0, 6000)}`,
          mode: "fast",
        });
        return ok("Webpage summarized.", { url, title, summary });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "AI_NOT_CONFIGURED")
          return fail("AI is not configured; cannot summarize.", {
            errorCode: "AI_NOT_CONFIGURED",
          });
        return fail(`Summarize failed: ${msg}`, { errorCode: "SUMMARY_ERROR" });
      }
    },
  });

  registerTool({
    name: "browser.submit_form",
    category: "browser",
    description:
      "Submit a form / perform a consequential web action. Disabled by default for safety.",
    risk: "high",
    requiresConfirmation: true,
    parameters: [
      { name: "url", type: "string", description: "Target URL", required: true },
      { name: "action", type: "string", description: "Description of the action", required: true },
    ],
    examples: ["Submit this form.", "Post this message."],
    async execute(_params, _ctx: ToolContext): Promise<ToolResult> {
      return fail(
        "Consequential browser actions (submitting forms, posting, purchasing) are disabled by default. Enable them explicitly in Settings > Security if you accept the risk, then confirm each action.",
        { errorCode: "ACTION_DISABLED", recoverable: false },
      );
    },
  });
}
