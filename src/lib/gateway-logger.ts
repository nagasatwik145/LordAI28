import { GATEWAY_CONFIG, type GatewayConfig } from "./gateway-config";
import { PROVIDER_CONFIG, type ProviderName } from "./lord-config";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(event: string, payload: Record<string, unknown>): void;
  info(event: string, payload: Record<string, unknown>): void;
  warn(event: string, payload: Record<string, unknown>): void;
  error(event: string, payload: Record<string, unknown>): void;
  startupValidation(
    providers: Array<{
      provider: string;
      healthy: string[];
      unhealthy: Array<{ model: string; reason: string; status?: string }>;
      disabledModels?: Array<{ model: string; reason: string; disabledUntil: number }>;
    }>,
  ): void;
  startupBanner(state: {
    configuredProviders: ProviderName[];
    enabledModels: Record<ProviderName, string[]>;
    disabledModels: Record<ProviderName, string[]>;
    healthCacheEntries: number;
    circuitBreakerEntries: number;
    preferredModels: Record<string, string>;
  }): void;
}

export function createLogger(config: GatewayConfig): Logger {
  const prefix = "[lord-gateway]";

  // Minimum level that is actually emitted. Set from config so production can
  // suppress high-volume debug/info logs while still surfacing warnings/errors.
  const LOG_THRESHOLD: number = LEVEL_WEIGHT[config.logLevel] ?? LEVEL_WEIGHT.info;

  function formatPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...payload, timestamp: Date.now() };
    return out;
  }

  function emit(level: LogLevel, event: string, payload: Record<string, unknown>) {
    if (LEVEL_WEIGHT[level] < LOG_THRESHOLD) return;
    const formatted = formatPayload(payload);
    if (config.logFormat === "pretty") {
      const lines = [
        `${prefix} ${level.toUpperCase()} ${event}`,
        JSON.stringify(formatted, null, 2),
      ];
      switch (level) {
        case "debug":
          console.debug(lines.join("\n"));
          break;
        case "info":
          console.info(lines.join("\n"));
          break;
        case "warn":
          console.warn(lines.join("\n"));
          break;
        case "error":
          console.error(lines.join("\n"));
          break;
      }
    } else {
      const entry = { level, event, ...formatted };
      switch (level) {
        case "debug":
          console.debug(JSON.stringify(entry));
          break;
        case "info":
          console.info(JSON.stringify(entry));
          break;
        case "warn":
          console.warn(JSON.stringify(entry));
          break;
        case "error":
          console.error(JSON.stringify(entry));
          break;
      }
    }
  }

  return {
    debug(event, payload) {
      emit("debug", event, payload);
    },
    info(event, payload) {
      emit("info", event, payload);
    },
    warn(event, payload) {
      emit("warn", event, payload);
    },
    error(event, payload) {
      emit("error", event, payload);
    },
    startupValidation(providers) {
      console.info("");
      console.info("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.info("LORD Provider Validation");
      console.info("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      for (const p of providers) {
        console.info("");
        console.info(p.provider);
        for (const m of p.healthy) {
          console.info(`  ✔ ${m}`);
        }
        for (const u of p.unhealthy) {
          const statusStr = u.status ? ` (${u.status})` : "";
          console.info(`  ✖ ${u.model}${statusStr}`);
          console.info(`    ${u.reason}`);
        }
        const disabled = p.disabledModels ?? [];
        for (const d of disabled) {
          const ts = new Date(d.disabledUntil).toISOString();
          console.info(`  ⊘ ${d.model} (disabled until ${ts})`);
          console.info(`    ${d.reason}`);
        }
      }
      console.info("");
      console.info("━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.info("");
    },
    startupBanner(state) {
      console.info("");
      console.info("==================================");
      console.info("LORD ACTIVE CONFIGURATION");
      console.info("==================================");
      for (const provider of state.configuredProviders) {
        const providerLabel =
          provider === "gemini" ? "Gemini" : provider === "openrouter" ? "OpenRouter" : "OpenAI";
        console.info("");
        console.info(providerLabel);
        const enabled = state.enabledModels[provider] ?? [];
        const disabled = state.disabledModels[provider] ?? [];
        if (enabled.length > 0) {
          for (const m of enabled) {
            console.info(`  ✔ ${m}`);
          }
        } else {
          console.info("  (none enabled)");
        }
        if (disabled.length > 0) {
          for (const m of disabled) {
            console.info(`  ⊘ ${m}`);
          }
        }
      }
      console.info("");
      console.info("Health Cache: " + state.healthCacheEntries + " entries");
      console.info("Circuit Breaker: " + state.circuitBreakerEntries + " entries");
      console.info("");
      console.info("Preferred Models:");
      for (const [mode, model] of Object.entries(state.preferredModels)) {
        console.info(`  ${mode}: ${model}`);
      }
      console.info("");
      console.info("==================================");
      console.info("");
    },
  };
}
