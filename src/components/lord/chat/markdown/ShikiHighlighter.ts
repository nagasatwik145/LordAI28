import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { Element, Root, RootContent } from "hast";

type Visitable = Root | Element;

let highlighterPromise: Promise<HighlighterCore> | null = null;

export class ShikiHighlighter {
  private static instance: ShikiHighlighter;
  private highlighter: HighlighterCore | null = null;

  private constructor() {}

  static getInstance(): ShikiHighlighter {
    if (!ShikiHighlighter.instance) {
      ShikiHighlighter.instance = new ShikiHighlighter();
    }
    return ShikiHighlighter.instance;
  }

  async getHighlighter(): Promise<HighlighterCore> {
    if (this.highlighter) return this.highlighter;

    if (!highlighterPromise) {
      highlighterPromise = this.createHighlighter();
    }

    this.highlighter = await highlighterPromise;
    return this.highlighter;
  }

  private async createHighlighter(): Promise<HighlighterCore> {
    return createHighlighterCore({
      themes: ["github-dark"],
      langs: [
        "typescript",
        "javascript",
        "python",
        "json",
        "bash",
        "sql",
        "html",
        "css",
        "markdown",
        "yaml",
        "rust",
        "go",
        "java",
        "cpp",
        "csharp",
        "php",
        "ruby",
        "swift",
        "kotlin",
        "dart",
        "xml",
      ],
      engine: createJavaScriptRegexEngine(),
    } as unknown as Parameters<typeof createHighlighterCore>[0]);
  }

  rehypePlugin() {
    return async (tree: Root) => {
      const highlighter = await this.getHighlighter();

      const visit = (node: Visitable) => {
        if (node.type === "element" && node.tagName === "pre") {
          const codeNode = node.children?.[0];
          if (codeNode && codeNode.type === "element" && codeNode.tagName === "code") {
            const className = codeNode.properties?.className;
            const rawClass = Array.isArray(className) ? String(className[0] ?? "") : "";
            const lang = rawClass.replace("language-", "") || "text";
            const firstChild = codeNode.children?.[0];
            const code = firstChild && "value" in firstChild ? String(firstChild.value) : "";

            try {
              const highlighted = highlighter.codeToHtml(code, {
                lang,
                theme: "github-dark",
              });

              node.tagName = "div";
              node.properties = {
                ...node.properties,
                className: [
                  "shiki-code-block",
                  "relative",
                  "overflow-hidden",
                  "rounded-xl",
                  "border",
                  "border-border/40",
                  "bg-[rgba(20,20,20,0.8)]",
                  "my-4",
                  "overflow-hidden",
                ],
                "data-language": lang,
              } as Element["properties"];
              node.children = [{ type: "raw", value: highlighted }] as Element["children"];
            } catch (e) {
              console.warn("Shiki highlighting failed:", e);
            }
          }
        }

        if (node.children) {
          node.children.forEach((child: RootContent) => visit(child as Visitable));
        }
      };

      visit(tree);
    };
  }
}

let rehypePluginPromise: Promise<(tree: Root) => Promise<void>> | null = null;

export async function getRehypePlugin() {
  const highlighter = ShikiHighlighter.getInstance();

  if (!rehypePluginPromise) {
    rehypePluginPromise = (async () => {
      await highlighter.getHighlighter();
      return highlighter.rehypePlugin();
    })();
  }

  return rehypePluginPromise;
}

export const shikiRehypePlugin = async () => {
  const plugin = await getRehypePlugin();
  return plugin;
};
