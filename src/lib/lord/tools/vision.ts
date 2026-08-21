// Vision Engine (spec §4).
//
// Two sources — SCREEN and WEBCAM. The server cannot capture a native screen or
// webcam, so it analyzes images that Lord or a paired device supplies (a
// screenshot upload, a webcam frame from Lord Mobile, etc.). Analysis is real:
// the image + question are sent to a vision-capable model (Gemini/OpenAI).
//
// The webcam has an explicit CAMERA OFF / CAMERA ON indicator and is OFF by
// default. Toggling it is an explicit, low-risk user action.

import { registerTool } from "../registry";
import { ok, fail, notConfigured } from "../permissions";
import { runLordVision } from "../llm";
import type { ToolContext, ToolResult } from "../types";

const CAMERA_KEY = Symbol.for("lord.vision.camera");
interface VisionRuntime {
  cameraOn: boolean;
}
function visionRuntime(): VisionRuntime {
  const g = globalThis as unknown as Record<symbol, VisionRuntime>;
  if (!g[CAMERA_KEY]) g[CAMERA_KEY] = { cameraOn: false };
  return g[CAMERA_KEY];
}

function isDataUrl(v: string): boolean {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v.trim());
}

export function registerVisionTools(): void {
  registerTool({
    name: "vision.analyze",
    category: "vision",
    description:
      "Analyze an image (screenshot or photo) and answer a question about it using a vision model.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "image", type: "string", description: "Image as a base64 data URL", required: true },
      {
        name: "question",
        type: "string",
        description: "What to analyze / ask about the image",
        required: false,
      },
    ],
    examples: ["What is on my screen?", "Read this error.", "Where is the button I need?"],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const image = String(params.image ?? "");
      const question = String(params.question ?? "Describe what you see in detail.");
      if (!isDataUrl(image)) {
        return fail("A base64 image data URL is required for analysis.", {
          errorCode: "BAD_IMAGE",
        });
      }
      try {
        ctx.log({ level: "info", source: "vision", message: "Analyzing image with vision model." });
        const { text, provider } = await runLordVision({ prompt: question, image });
        return ok("Vision analysis complete.", { analysis: text, provider });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === "AI_NOT_CONFIGURED") {
          return notConfigured("Vision", "No AI provider with vision support is configured.");
        }
        return fail(`Vision analysis failed: ${msg}`, { errorCode: "VISION_ERROR" });
      }
    },
  });

  registerTool({
    name: "vision.webcam_status",
    category: "vision",
    description: "Return whether the webcam is currently ON or OFF.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Is the camera on?"],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const rt = visionRuntime();
      ctx.log({
        level: "info",
        source: "vision",
        message: `Webcam status queried: ${rt.cameraOn ? "ON" : "OFF"}`,
      });
      return ok(rt.cameraOn ? "Camera is ON." : "Camera is OFF.", { cameraOn: rt.cameraOn });
    },
  });

  registerTool({
    name: "vision.webcam_toggle",
    category: "vision",
    description:
      "Turn the webcam ON or OFF. Off by default. When ON, frames can be analyzed via vision.analyze.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "on", type: "boolean", description: "true = ON, false = OFF", required: true },
    ],
    examples: ["Turn the camera on.", "Camera off."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const on = Boolean(params.on);
      visionRuntime().cameraOn = on;
      ctx.log({
        level: on ? "warn" : "info",
        source: "vision",
        message: `Webcam ${on ? "ENABLED" : "disabled"}.`,
      });
      return ok(on ? "Camera is now ON." : "Camera is now OFF.", { cameraOn: on });
    },
  });
}
