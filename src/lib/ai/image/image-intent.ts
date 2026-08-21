/** Extensible, deterministic routing before a message enters the chat gateway. */
const IMAGE_PATTERNS = [
  /\b(draw|paint|sketch|render)\b/i,
  /\b(generate|create|make)\s+(?:an?\s+)?(?:image|picture|visual|artwork|logo|icon|poster|wallpaper|avatar|thumbnail|illustration)\b/i,
  /\b(logo|icon pack|wallpaper|book cover|anime|concept art|pixel art|comic|cinematic|portrait|ui mockup|infographic|avatar|thumbnail)\b/i,
];

const CHAT_GUARDS = [/\b(explain|describe|history of|what is|how does|why does)\b/i];

export function detectImageIntent(text: string): boolean {
  const normalized = text.trim();
  return (
    !CHAT_GUARDS.some((pattern) => pattern.test(normalized)) &&
    IMAGE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}
