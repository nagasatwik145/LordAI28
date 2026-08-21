export type ImagePromptProfile =
  | "photorealistic"
  | "anime"
  | "illustration"
  | "pixel-art"
  | "ui-design"
  | "logo"
  | "icons"
  | "poster"
  | "comic";

const PROFILE_HINTS: Record<ImagePromptProfile, string> = {
  photorealistic:
    "photorealistic, cinematic lighting, natural materials, high detail, depth of field",
  anime: "anime illustration, expressive character design, clean linework, vibrant cel shading",
  illustration: "editorial illustration, intentional composition, detailed color and texture",
  "pixel-art": "pixel art, crisp pixel edges, limited intentional palette, no anti-aliasing",
  "ui-design":
    "polished product UI mockup, clear information hierarchy, accessible typography, design system consistency",
  logo: "distinctive logo mark, simple vector-like geometry, centered composition, no watermark or tiny text",
  icons:
    "cohesive icon set, consistent stroke weight and visual language, isolated on a clean background",
  poster:
    "striking poster design, cinematic composition, deliberate typography space, high contrast",
  comic: "comic-book illustration, inked linework, dramatic framing, rich color",
};

export function inferImagePromptProfile(prompt: string): ImagePromptProfile {
  const p = prompt.toLowerCase();
  if (/anime|manga/.test(p)) return "anime";
  if (/pixel/.test(p)) return "pixel-art";
  if (/ui|mockup|dashboard|app screen/.test(p)) return "ui-design";
  if (/logo|brand mark/.test(p)) return "logo";
  if (/icon/.test(p)) return "icons";
  if (/poster|cover/.test(p)) return "poster";
  if (/comic/.test(p)) return "comic";
  if (/illustration|watercolor|drawing/.test(p)) return "illustration";
  return "photorealistic";
}

export function enhanceImagePrompt(
  prompt: string,
  enabled = true,
  profile?: ImagePromptProfile,
): { prompt: string; profile: ImagePromptProfile } {
  const resolved = profile ?? inferImagePromptProfile(prompt);
  if (!enabled) return { prompt: prompt.trim(), profile: resolved };
  return {
    prompt: `${prompt.trim()}, ${PROFILE_HINTS[resolved]}, thoughtfully composed, production quality`,
    profile: resolved,
  };
}
