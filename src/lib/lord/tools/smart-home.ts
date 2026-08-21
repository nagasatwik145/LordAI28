// Smart Home / ESP32 (spec §9).
//
// Talks to local IoT devices (ESP32 and compatible) over HTTP when a controller
// base URL is configured (LORD_ESP32_BASE_URL). Without it, devices are tracked
// as offline/simulated so the UI and Automations still work end-to-end. Every
// control action is MEDIUM risk and confirmation-gated.

import { registerTool } from "../registry";
import { ok, fail, notConfigured } from "../permissions";
import { getState, setConnection } from "../state";
import { getLordConfig } from "../config";
import type { IoTDevice, ToolContext, ToolResult } from "../types";

function refreshConnection(): void {
  const state = getState();
  const online = state.iot.filter((d) => d.online).length;
  setConnection({
    smartHome: state.iot.length ? "online" : "offline",
    details: {
      ...state.connections.details,
      smartHome: String(state.iot.length),
      smartHomeOnline: String(online),
    },
  });
}

export function registerSmartHomeTools(): void {
  registerTool({
    name: "sm.devices",
    category: "smart-home",
    description: "List connected smart-home / ESP32 devices and their state.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Show my devices.", "What's the temperature?"],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      ctx.log({ level: "info", source: "sm", message: "Listed IoT devices." });
      return ok(state.iot.length ? `${state.iot.length} device(s).` : "No devices configured.", {
        devices: state.iot,
        configured: Boolean(getLordConfig().esp32BaseUrl),
        baseUrl: getLordConfig().esp32BaseUrl ? "(set)" : "(not set)",
      });
    },
  });

  registerTool({
    name: "sm.add_device",
    category: "smart-home",
    description: "Register a smart-home device (relay, light, sensor, switch, fan).",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "name", type: "string", description: "Human-friendly name", required: true },
      {
        name: "kind",
        type: "string",
        description: "relay | light | sensor | switch | fan | other",
        required: true,
      },
      {
        name: "endpoint",
        type: "string",
        description: "Relative endpoint path on the ESP32 controller",
        required: false,
      },
    ],
    examples: ["Add the study room fan."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const device: IoTDevice = {
        id: crypto.randomUUID(),
        name: String(params.name ?? "Device"),
        kind: String(params.kind ?? "other") as IoTDevice["kind"],
        online: Boolean(getLordConfig().esp32BaseUrl),
        state: "off",
        endpoint: params.endpoint ? String(params.endpoint) : undefined,
      };
      state.iot.push(device);
      refreshConnection();
      ctx.log({ level: "warn", source: "sm", message: `Added device: ${device.name}` });
      return ok(`Device "${device.name}" added.`, { device });
    },
  });

  registerTool({
    name: "sm.control",
    category: "smart-home",
    description:
      "Turn a device ON/OFF or set its state. Sends a real HTTP command when a controller is configured.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "deviceId", type: "string", description: "Device id", required: true },
      { name: "state", type: "string", description: "on | off | 0-100", required: true },
    ],
    examples: ["Turn on the study room fan.", "Turn off the light."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const device = state.iot.find((d) => d.id === params.deviceId);
      if (!device) return fail("Device not found.", { errorCode: "DEVICE_NOT_FOUND" });
      const next = String(params.state ?? "off");
      const base = getLordConfig().esp32BaseUrl;
      if (base && device.endpoint) {
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}${device.endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state: next }),
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          device.state = next;
          device.online = true;
          ctx.log({ level: "warn", source: "sm", message: `${device.name} -> ${next} (ESP32)` });
          return ok(`${device.name} set to ${next}.`, { device });
        } catch (err) {
          device.online = false;
          refreshConnection();
          return fail(`Could not reach device: ${(err as Error).message}`, {
            errorCode: "DEVICE_UNREACHABLE",
          });
        }
      }
      // No controller configured: simulate the state locally.
      device.state = next;
      ctx.log({
        level: "warn",
        source: "sm",
        message: `${device.name} -> ${next} (simulated, no controller)`,
      });
      return ok(
        `${device.name} set to ${next} (simulated — set LORD_ESP32_BASE_URL for live control).`,
        { device },
      );
    },
  });

  registerTool({
    name: "sm.read_sensors",
    category: "smart-home",
    description: "Read the latest sensor values for a device (temperature, humidity, etc.).",
    risk: "low",
    requiresConfirmation: false,
    parameters: [{ name: "deviceId", type: "string", description: "Device id", required: true }],
    examples: ["Show the temperature.", "Read the soil moisture."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const device = state.iot.find((d) => d.id === params.deviceId);
      if (!device) return fail("Device not found.", { errorCode: "DEVICE_NOT_FOUND" });
      const base = getLordConfig().esp32BaseUrl;
      if (base && device.endpoint) {
        try {
          const res = await fetch(`${base.replace(/\/$/, "")}${device.endpoint}/sensors`, {
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as Record<string, number>;
          device.sensors = data;
          device.online = true;
          refreshConnection();
          ctx.log({ level: "info", source: "sm", message: `Sensors read for ${device.name}` });
          return ok(`Sensor readings for ${device.name}.`, { device, sensors: data });
        } catch (err) {
          device.online = false;
          refreshConnection();
          return fail(`Could not read sensors: ${(err as Error).message}`, {
            errorCode: "SENSOR_ERROR",
          });
        }
      }
      if (!device.sensors) {
        return notConfigured(
          "Live sensor readings",
          "Set LORD_ESP32_BASE_URL and a device endpoint to read real sensor data. Showing last known values if any.",
        );
      }
      return ok(`Last known sensor readings for ${device.name}.`, {
        device,
        sensors: device.sensors,
      });
    },
  });
}
