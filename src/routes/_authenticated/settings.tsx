import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/lord/AppShell";
import { TokenUsagePanel } from "@/components/lord/TokenUsagePanel";
import { getUserSettings, updateUserSettings } from "@/lib/user-settings.functions";
import { supabase } from "@/integrations/supabase/client";
import { useTokenUsage } from "@/lib/token-usage-store";
import { getModelDef } from "@/components/lord/chat/input/models";
import { emitDashboardEvent } from "@/lib/dashboard-service";
import { cn } from "@/lib/utils";
import {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_LABELS,
  type MemoryCategory,
  type MemoryRecord,
  type MemorySettings,
} from "@/lib/memory";
import {
  useMemories,
  useMemorySettings,
  useUpdateMemorySettings,
  useClearMemories,
} from "@/lib/memory";
import {
  Loader2,
  Trash2,
  Download,
  RotateCcw,
  Sparkles,
  Brain,
  ShieldCheck,
  ShieldOff,
  User,
  Mail,
  Fingerprint,
  Crown,
  Palette,
  Zap,
  RectangleHorizontal,
  Columns,
  Activity,
  Layers,
  Clock,
  ChevronDown,
  Pin,
  Target,
  Calendar,
  Image as ImageIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getImageGenDefaults,
  setImageGenDefaults,
  type ImageSizePreset,
} from "@/lib/image-settings";
import { IMAGE_MODEL_REGISTRY, DEFAULT_IMAGE_MODEL_ID } from "@/lib/ai/image";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "LORD — Settings" }] }),
  component: SettingsPage,
});

const MODE_KEYS = ["fast", "balanced", "reasoning", "coding", "creative"] as const;
const THEME_KEYS = ["dark", "light"] as const;

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 280, damping: 24 } },
};

function useCollapsibleState(key: string, defaultOpen: boolean) {
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return defaultOpen;
    const stored = window.localStorage.getItem(key);
    return stored === null ? defaultOpen : stored === "1";
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, next ? "1" : "0");
      }
      return next;
    });
  }, [key]);

  return [open, toggle] as const;
}

function CollapsibleCard({
  storageKey,
  defaultOpen,
  icon: Icon,
  title,
  subtitle,
  summary,
  children,
}: {
  storageKey: string;
  defaultOpen: boolean;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, toggle] = useCollapsibleState(storageKey, defaultOpen);

  return (
    <motion.section
      variants={itemVariants}
      className="hud-panel relative overflow-hidden rounded-xl"
    >
      <motion.button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group relative flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent px-6 py-5 text-left transition-all duration-200 hover:border-[color:var(--hud)]/30 hover:bg-[color:var(--hud)]/[0.04] hover:shadow-[0_0_18px_var(--hud)]"
      >
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-br from-[color:var(--hud)]/5 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--hud)]/20 bg-[color:var(--hud)]/10 transition-shadow duration-200 group-hover:shadow-[0_0_14px_var(--hud)]">
          <Icon className="h-4 w-4 text-[color:var(--hud)]" />
        </div>
        <div className="relative min-w-0 flex-1">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wider gradient-text">
            {title}
          </h3>
          <p className="truncate text-[10px] text-muted-foreground">{open ? subtitle : summary}</p>
        </div>
        <motion.div
          className="relative text-muted-foreground"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <ChevronDown className="h-5 w-5" />
        </motion.div>
      </motion.button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0, y: -8 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="relative border-t border-border/30 px-6 py-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function SettingsToggle({
  icon: Icon,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm">{label}</p>
          <p className="text-[10px] text-muted-foreground">{description}</p>
        </div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-[color:var(--hud)]" : "bg-border/60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

function SettingsPage() {
  const fetchSettings = useServerFn(getUserSettings);
  const saveSettings = useServerFn(updateUserSettings);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["user_settings"],
    queryFn: () => fetchSettings(),
  });
  const { user } = Route.useRouteContext();

  const { latest: latestUsage } = useTokenUsage();

  const [defaultMode, setDefaultMode] = useState("balanced");
  const [voiceRate, setVoiceRate] = useState(1);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState("dark");
  const [imgDefaults, setImgDefaults] = useState(getImageGenDefaults());

  useEffect(() => {
    if (!data || typeof data === "string") return;
    const settings = data as {
      default_mode: string;
      voice_rate: number;
      auto_speak: boolean;
      notifications_enabled: boolean;
      theme: string;
    };
    setDefaultMode(settings.default_mode ?? "balanced");
    setVoiceRate(Number(settings.voice_rate ?? 1));
    setAutoSpeak(settings.auto_speak ?? true);
    setNotifications(settings.notifications_enabled ?? true);
    setTheme(settings.theme ?? "dark");
  }, [data]);

  const { data: memories = [], isLoading: memoriesLoading } = useMemories(user?.id);
  const { data: memorySettings } = useMemorySettings(user?.id);
  const clearMemories = useClearMemories(user?.id);
  const updateMemorySettings = useUpdateMemorySettings(user?.id);

  const mutation = useMutation({
    mutationFn: (vars: {
      default_mode: string;
      voice_rate: number;
      auto_speak: boolean;
      notifications_enabled: boolean;
    }) =>
      saveSettings({
        data: {
          default_mode: vars.default_mode as (typeof MODE_KEYS)[number],
          voice_rate: vars.voice_rate,
          auto_speak: vars.auto_speak,
          notifications_enabled: vars.notifications_enabled,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user_settings"] }),
  });

  const themeMutation = useMutation({
    mutationFn: (newTheme: string) =>
      saveSettings({ data: { theme: newTheme as "dark" | "light" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user_settings"] });
      emitDashboardEvent("all");
    },
  });

  const analytics = useMemo(() => {
    const total = memories.length;
    const pinned = memories.filter((m) => m.pinned).length;
    const counts: Record<MemoryCategory, number> = {
      profile: 0,
      preference: 0,
      fact: 0,
      project: 0,
      note: 0,
    };
    memories.forEach((m) => {
      if (m.category in counts) counts[m.category as MemoryCategory]++;
    });
    const sorted = [...memories].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const newest = sorted.length ? sorted[sorted.length - 1].created_at : null;
    const oldest = sorted.length ? sorted[0].created_at : null;
    const diversity = Object.values(counts).filter((v) => v > 0).length;
    const health =
      total > 0
        ? Math.min(
            100,
            Math.round((pinned / total) * 35 + (diversity / 5) * 35 + Math.min(total / 20, 1) * 30),
          )
        : 0;
    return { total, pinned, counts, newest, oldest, health };
  }, [memories]);

  const exportMemories = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      userId: user?.id,
      count: memories.length,
      memories: memories.map((m) => ({
        content: m.content,
        category: m.category,
        pinned: m.pinned,
        confidence: m.confidence,
        source: m.source,
        created_at: m.created_at,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lord-memories-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearAllMemories = async () => {
    if (!confirm("Delete ALL your memories? This cannot be undone.")) return;
    try {
      await clearMemories.mutateAsync();
      emitDashboardEvent("memory");
    } catch {
      /* ignore */
    }
  };

  const setMemorySetting = async (
    patch: Partial<Omit<MemorySettings, "user_id" | "updated_at">>,
  ) => {
    try {
      await updateMemorySettings.mutateAsync(patch);
    } catch {
      /* ignore */
    }
  };

  const wipe = () => {
    if (!confirm("Clear local LORD cache (memories cache, tasks, goals)?")) return;
    if (typeof window === "undefined") return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith("lord:"))
      .forEach((k) => localStorage.removeItem(k));
    location.reload();
  };

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    window.location.replace("/auth");
  };

  return (
    <AppShell>
      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-6"
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="hud-panel rounded-xl p-6">
                <div className="mb-4 h-5 w-40 animate-pulse rounded-md bg-primary/10" />
                <div className="mb-3 h-4 w-2/3 animate-pulse rounded-md bg-primary/5" />
                <div className="h-32 w-full animate-pulse rounded-lg bg-primary/5" />
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="mx-auto max-w-3xl space-y-6 pb-10"
          >
            <motion.div variants={itemVariants}>
              <h1 className="font-display text-3xl tracking-wide gradient-text text-glow">
                Settings
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Tune LORD's behavior. Synced to your account.
              </p>
            </motion.div>

            {/* Account — always expanded */}
            <motion.section variants={itemVariants}>
              <div className="hud-panel relative overflow-hidden rounded-xl p-6">
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[color:var(--hud)]/5 via-transparent to-transparent" />
                <div className="relative flex items-center gap-4">
                  <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[color:var(--hud)]/40 bg-background/40 shadow-[0_0_24px_var(--hud)]">
                    <User className="h-7 w-7 text-[color:var(--hud)]" />
                    <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-background bg-[color:var(--hud-success)]" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold gradient-text">
                      {(user?.user_metadata?.name as string | undefined) ??
                        user?.email?.split("@")[0] ??
                        "LORD Operator"}
                    </h2>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-[color:var(--hud)]/30 bg-[color:var(--hud)]/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--hud)] shadow-[0_0_10px_var(--hud)]">
                      <Crown className="h-3 w-3" />
                      Premium
                    </span>
                  </div>
                </div>

                <div className="relative mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="group flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 p-3.5 transition-colors duration-200 hover:border-[color:var(--hud)]/30">
                    <Mail className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-[color:var(--hud)]" />
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Email
                      </p>
                      <p className="truncate font-mono text-sm text-foreground/90">
                        {user?.email ?? "—"}
                      </p>
                    </div>
                  </div>
                  <div className="group flex items-center gap-3 rounded-lg border border-border/60 bg-background/30 p-3.5 transition-colors duration-200 hover:border-[color:var(--hud)]/30">
                    <Fingerprint className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-[color:var(--hud)]" />
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        User ID
                      </p>
                      <p className="truncate font-mono text-xs text-foreground/70">
                        {user?.id ? `${user.id.slice(0, 8)}…${user.id.slice(-4)}` : "—"}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="relative mt-5 flex flex-wrap gap-3">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={signOut}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:border-[color:var(--hud)]/50 hover:text-[color:var(--hud)]"
                  >
                    Sign Out
                  </motion.button>
                  <button
                    disabled
                    className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-border/40 bg-background/20 px-4 py-2.5 text-sm font-medium text-muted-foreground opacity-50"
                  >
                    Manage Account
                  </button>
                </div>
              </div>
            </motion.section>

            {/* AI Personalization */}
            <CollapsibleCard
              storageKey="lord.settings.personalization"
              defaultOpen={false}
              icon={Palette}
              title="AI Personalization"
              subtitle="Customize your visual experience"
              summary={`Theme: ${theme === "dark" ? "Dark" : "Light"}`}
            >
              <div className="relative">
                <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Theme</p>
                <div className="flex gap-2">
                  {THEME_KEYS.map((t) => (
                    <motion.button
                      key={t}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        setTheme(t);
                        if (typeof window !== "undefined") {
                          document.documentElement.classList.toggle("dark", t === "dark");
                        }
                        themeMutation.mutate(t);
                      }}
                      className={cn(
                        "flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                        theme === t
                          ? "border-[color:var(--hud)] bg-[color:var(--hud)]/15 text-[color:var(--hud)] shadow-[0_0_18px_var(--hud)]"
                          : "border-border/50 text-muted-foreground hover:border-[color:var(--hud)]/30 hover:text-foreground/80",
                      )}
                    >
                      {t === "dark" ? "Dark" : "Light"}
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="relative mt-6 border-t border-border/30 pt-5">
                <p className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Coming Soon
                </p>
                <div className="grid gap-2.5">
                  {[
                    { icon: Palette, label: "Accent Color" },
                    { icon: Zap, label: "Animation Level" },
                    { icon: RectangleHorizontal, label: "Compact Mode" },
                    { icon: Columns, label: "Sidebar Behaviour" },
                    { icon: Brain, label: "AI Personality" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg border border-border/40 bg-background/20 p-3 opacity-60 transition-opacity duration-200 hover:opacity-80"
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{item.label}</span>
                      </div>
                      <span className="rounded-md border border-border/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        Soon
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleCard>

            {/* Image Providers */}
            <CollapsibleCard
              storageKey="lord.settings.image-providers"
              defaultOpen={false}
              icon={ImageIcon}
              title="Image Providers"
              subtitle="Default image generation behavior"
              summary={`Provider: Cloudflare · ${imgDefaults.defaultResolution} · ${imgDefaults.defaultAspectRatio}`}
            >
              <div className="relative space-y-4">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                    Default Provider
                  </p>
                  <select
                    value="cloudflare"
                    disabled
                    className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm opacity-70"
                  >
                    <option value="cloudflare">Cloudflare Workers AI</option>
                  </select>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Default Model
                    </p>
                    <select
                      value={imgDefaults.defaultModel || DEFAULT_IMAGE_MODEL_ID}
                      onChange={(e) =>
                        setImgDefaults(setImageGenDefaults({ defaultModel: e.target.value }))
                      }
                      className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
                    >
                      <option value={DEFAULT_IMAGE_MODEL_ID}>Default (auto)</option>
                      {IMAGE_MODEL_REGISTRY.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Default Resolution
                    </p>
                    <select
                      value={imgDefaults.defaultResolution}
                      onChange={(e) =>
                        setImgDefaults(
                          setImageGenDefaults({
                            defaultResolution: e.target.value as ImageSizePreset,
                          }),
                        )
                      }
                      className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
                    >
                      <option value="square">Square</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Default Aspect Ratio
                    </p>
                    <select
                      value={imgDefaults.defaultAspectRatio}
                      onChange={(e) =>
                        setImgDefaults(setImageGenDefaults({ defaultAspectRatio: e.target.value }))
                      }
                      className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
                    >
                      {["1:1", "16:9", "9:16", "4:3", "3:4"].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Default Image Count
                    </p>
                    <select
                      value={imgDefaults.defaultImageCount}
                      onChange={(e) =>
                        setImgDefaults(
                          setImageGenDefaults({ defaultImageCount: Number(e.target.value) }),
                        )
                      }
                      className="w-full rounded-md border border-border/40 bg-background/30 px-3 py-2 text-sm"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground/90">
                  <input
                    type="checkbox"
                    checked={imgDefaults.enhancePrompt}
                    onChange={(e) =>
                      setImgDefaults(setImageGenDefaults({ enhancePrompt: e.target.checked }))
                    }
                  />
                  Enhance prompts by default
                </label>

                <p className="text-[10px] text-muted-foreground">
                  The Cloudflare provider is configured server-side via CLOUDFLARE_ACCOUNT_ID and
                  CLOUDFLARE_API_TOKEN. Add OpenAI, Gemini, or other providers by registering a new
                  provider adapter — no UI changes required.
                </p>
              </div>
            </CollapsibleCard>

            {/* Memory — privacy controls + link to the full Memory dashboard */}
            <CollapsibleCard
              storageKey="lord.settings.memory"
              defaultOpen={false}
              icon={Brain}
              title="Memory"
              subtitle="Control what LORD remembers about you"
              summary={`${memories.length} memories · ${memorySettings?.memory_enabled === false ? "off" : "on"}`}
            >
              <div className="relative">
                <p className="text-xs text-muted-foreground">
                  Manage, search, edit, pin and export your memories on the dedicated{" "}
                  <Link
                    to="/memory"
                    className="text-[color:var(--hud)] underline-offset-2 hover:underline"
                  >
                    Memory page
                  </Link>
                  .
                </p>

                <div className="relative mt-4 space-y-3">
                  <SettingsToggle
                    icon={memorySettings?.memory_enabled === false ? ShieldOff : ShieldCheck}
                    label="Memory"
                    description="Let LORD remember things across chats"
                    checked={memorySettings?.memory_enabled ?? true}
                    onChange={(v) => setMemorySetting({ memory_enabled: v })}
                  />
                  <SettingsToggle
                    icon={Brain}
                    label="Auto-save"
                    description="Save high-confidence memories without asking"
                    checked={memorySettings?.auto_save ?? true}
                    disabled={memorySettings?.memory_enabled === false}
                    onChange={(v) => setMemorySetting({ auto_save: v })}
                  />
                  <SettingsToggle
                    icon={ShieldCheck}
                    label="Ask before saving"
                    description="Confirm lower-confidence memories first"
                    checked={memorySettings?.ask_before_save ?? true}
                    disabled={memorySettings?.memory_enabled === false}
                    onChange={(v) => setMemorySetting({ ask_before_save: v })}
                  />
                </div>

                <div className="relative mt-5 flex flex-wrap gap-3 border-t border-border/30 pt-4">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={exportMemories}
                    disabled={memories.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:border-[color:var(--hud)]/50 hover:text-[color:var(--hud)] disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    Export Memories
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={clearAllMemories}
                    disabled={memories.length === 0}
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-all duration-200 hover:border-destructive/60 hover:bg-destructive/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete All Memories
                  </motion.button>
                </div>
              </div>
            </CollapsibleCard>

            {/* Memory Analytics */}
            <CollapsibleCard
              storageKey="lord.settings.analytics"
              defaultOpen={false}
              icon={Activity}
              title="Memory Analytics"
              subtitle="Insights from your stored memories"
              summary={`${analytics.health}% Health • ${analytics.total} memories`}
            >
              <div className="relative mt-0 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
                <div className="relative shrink-0">
                  <svg viewBox="0 0 120 120" className="h-28 w-28 -rotate-90">
                    <circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      className="text-border"
                      strokeWidth="8"
                    />
                    <motion.circle
                      cx="60"
                      cy="60"
                      r="50"
                      fill="none"
                      className="text-[color:var(--hud-success)]"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 50}
                      initial={{ strokeDashoffset: 2 * Math.PI * 50 }}
                      animate={{
                        strokeDashoffset: 2 * Math.PI * 50 * (1 - analytics.health / 100),
                      }}
                      transition={{ duration: 1.5, ease: "easeOut" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-display text-lg font-bold text-foreground">
                      {analytics.health}%
                    </span>
                  </div>
                </div>

                <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      label: "Total Memories",
                      value: analytics.total,
                      icon: Layers,
                      color: "text-[color:var(--hud)]",
                    },
                    {
                      label: "Pinned Memories",
                      value: analytics.pinned,
                      icon: Pin,
                      color: "text-amber-400",
                    },
                    {
                      label: "Categories",
                      value: Object.values(analytics.counts).filter((v) => v > 0).length,
                      icon: Target,
                      color: "text-[color:var(--hud-success)]",
                    },
                    {
                      label: "Newest",
                      value: analytics.newest
                        ? new Date(analytics.newest).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })
                        : "—",
                      icon: Calendar,
                      color: "text-[color:var(--hud)]",
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-lg border border-border/40 bg-background/20 p-3"
                    >
                      <stat.icon className={cn("mb-2 h-4 w-4", stat.color)} />
                      <p className="font-display text-lg font-bold text-foreground">{stat.value}</p>
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative mt-5 border-t border-border/30 pt-4">
                <p className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Distribution
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {MEMORY_CATEGORIES.map((cat) => {
                    const count = analytics.counts[cat] ?? 0;
                    const pct =
                      analytics.total > 0 ? Math.round((count / analytics.total) * 100) : 0;
                    return (
                      <div
                        key={cat}
                        className="rounded-lg border border-border/40 bg-background/20 p-3 text-center"
                      >
                        <p className="font-display text-base font-bold text-foreground">{count}</p>
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                          {MEMORY_CATEGORY_LABELS[cat]}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60">{pct}%</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="relative mt-4 flex items-center gap-2 border-t border-border/30 pt-4 text-xs text-muted-foreground">
                <Clock className={cn("h-3.5 w-3.5", "text-muted-foreground")} />
                <span className="uppercase tracking-widest">Oldest</span>
                <span className="text-foreground/80">
                  {analytics.oldest
                    ? new Date(analytics.oldest).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                </span>
              </div>
            </CollapsibleCard>

            {/* Token Usage */}
            <CollapsibleCard
              storageKey="lord.settings.token-usage"
              defaultOpen={false}
              icon={Activity}
              title="Token Usage"
              subtitle="Monitor AI token consumption"
              summary={
                latestUsage
                  ? `Total ${latestUsage.totalTokens} • $${latestUsage.cost.toFixed(4)} • ${getModelDef(latestUsage.model)?.label ?? latestUsage.model}`
                  : "Live token metrics"
              }
            >
              <TokenUsagePanel />
            </CollapsibleCard>

            {/* Privacy & Data */}
            <CollapsibleCard
              storageKey="lord.settings.privacy"
              defaultOpen={false}
              icon={ShieldCheck}
              title="Privacy & Data"
              subtitle="Manage your local data and account"
              summary="2 actions available"
            >
              <div className="relative mt-0 flex flex-wrap gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={wipe}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-all duration-200 hover:border-destructive/60 hover:bg-destructive/20"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear Local Cache
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={signOut}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/60 bg-background/40 px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:border-[color:var(--hud)]/50 hover:text-[color:var(--hud)]"
                >
                  Sign Out
                </motion.button>
              </div>

              <div className="relative mt-5 border-t border-border/30 pt-5">
                <p className="mb-3 text-[10px] uppercase tracking-widest text-muted-foreground">
                  Coming Soon
                </p>
                <div className="grid gap-2.5">
                  {[
                    { icon: Download, label: "Download Data" },
                    { icon: Trash2, label: "Delete Account" },
                    { icon: RotateCcw, label: "Reset Settings" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-lg border border-border/40 bg-background/20 p-3 opacity-60 transition-opacity duration-200 hover:opacity-80"
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm">{item.label}</span>
                      </div>
                      <span className="rounded-md border border-border/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                        Soon
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CollapsibleCard>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}
