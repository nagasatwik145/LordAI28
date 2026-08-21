import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const SettingsSchema = z.object({
  default_mode: z.enum(["fast", "balanced", "reasoning", "coding", "creative"]).optional(),
  voice_rate: z.number().min(0.5).max(2).optional(),
  auto_speak: z.boolean().optional(),
  notifications_enabled: z.boolean().optional(),
  theme: z.enum(["dark", "light"]).optional(),
});

export type UserSettingsInput = z.infer<typeof SettingsSchema>;

export const getUserSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_settings")
      .select("default_mode, voice_rate, auto_speak, notifications_enabled, theme")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("[getUserSettings] supabase select error:", error);
      throw error;
    }
    return (
      data ?? {
        default_mode: "balanced",
        voice_rate: 1,
        auto_speak: true,
        notifications_enabled: true,
        theme: "dark",
      }
    );
  });

export const updateUserSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SettingsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      user_id: userId,
      ...data,
      updated_at: new Date().toISOString(),
    } satisfies Database["public"]["Tables"]["user_settings"]["Insert"];
    const { error } = await supabase
      .from("user_settings")
      .upsert(payload, { onConflict: "user_id" });
    if (error) {
      console.error("[updateUserSettings] supabase upsert error:", error);
      throw error;
    }
    return { ok: true };
  });
