// Mobile Link (spec §8).
//
// A real, stateful pairing flow. Lord generates a short-lived, rotating token
// and a QR payload the Android companion scans. Pairing completes only when the
// device presents the exact active token, after which the device is tracked as
// connected. No sensitive network details are leaked in the QR beyond a host
// identifier and the ephemeral token.

import { registerTool } from "../registry";
import { ok, fail } from "../permissions";
import { getState, setConnection } from "../state";
import os from "node:os";
import type { ToolContext, ToolResult } from "../types";

const PAIR_TTL_MS = 5 * 60 * 1000;

function hostId(): string {
  try {
    return os.hostname();
  } catch {
    return "lord-server";
  }
}

export function registerMobileTools(): void {
  registerTool({
    name: "mobile.pair_start",
    category: "mobile",
    description: "Begin pairing a Lord Mobile (Android) device. Generates a rotating QR token.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Connect my phone.", "Pair Android device."],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const session = {
        id: crypto.randomUUID(),
        token,
        qrPayload: `lord://pair?token=${token}&host=${encodeURIComponent(hostId())}`,
        createdAt: Date.now(),
        expiresAt: Date.now() + PAIR_TTL_MS,
      };
      state.mobile.pairing = session;
      ctx.log({
        level: "info",
        source: "mobile",
        message: "Pairing session started (token rotating).",
      });
      return ok("Waiting for device...", {
        pairingId: session.id,
        qrPayload: session.qrPayload,
        token,
        expiresAt: session.expiresAt,
      });
    },
  });

  registerTool({
    name: "mobile.pair_complete",
    category: "mobile",
    description: "Complete pairing once the Android device presents a valid token.",
    risk: "medium",
    requiresConfirmation: true,
    parameters: [
      { name: "token", type: "string", description: "Token shown in the QR code", required: true },
      {
        name: "deviceName",
        type: "string",
        description: "Name reported by the device",
        required: true,
      },
      {
        name: "localIp",
        type: "string",
        description: "Device local IP (optional)",
        required: false,
      },
    ],
    examples: ["Device NYX-Phone paired."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const pairing = state.mobile.pairing;
      if (!pairing)
        return fail("No active pairing session. Start pairing first.", { errorCode: "NO_PAIRING" });
      if (Date.now() > pairing.expiresAt) {
        state.mobile.pairing = null;
        return fail("Pairing token expired. Start a new pairing session.", {
          errorCode: "TOKEN_EXPIRED",
        });
      }
      if (params.token !== pairing.token) {
        return fail("Pairing token does not match. Pairing rejected.", {
          errorCode: "TOKEN_MISMATCH",
        });
      }
      const device = {
        id: crypto.randomUUID(),
        name: String(params.deviceName ?? "Lord Mobile"),
        pairedAt: Date.now(),
        lastSeen: Date.now(),
        status: "connected" as const,
        localIp: params.localIp ? String(params.localIp) : undefined,
        battery: undefined,
        token: pairing.token,
      };
      state.mobile.devices.push(device);
      state.mobile.pairing = null;
      setConnection({
        mobile: "online",
        details: { ...state.connections.details, mobile: device.name },
      });
      ctx.log({ level: "success", source: "mobile", message: `Device paired: ${device.name}` });
      return ok("LORD MOBILE CONNECTED", {
        device: {
          id: device.id,
          name: device.name,
          status: device.status,
          localIp: device.localIp,
        },
      });
    },
  });

  registerTool({
    name: "mobile.status",
    category: "mobile",
    description: "Show paired devices and current pairing state.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [],
    examples: ["Are any phones connected?"],
    async execute(_params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      ctx.log({ level: "info", source: "mobile", message: "Mobile status queried." });
      return ok(
        state.mobile.devices.length
          ? `${state.mobile.devices.length} device(s) connected.`
          : "No devices connected.",
        {
          devices: state.mobile.devices,
          pairing: state.mobile.pairing
            ? { active: true, expiresAt: state.mobile.pairing.expiresAt }
            : { active: false },
        },
      );
    },
  });

  registerTool({
    name: "mobile.disconnect",
    category: "mobile",
    description: "Disconnect a paired mobile device.",
    risk: "low",
    requiresConfirmation: false,
    parameters: [
      { name: "deviceId", type: "string", description: "Device id to disconnect", required: true },
    ],
    examples: ["Disconnect my phone."],
    async execute(params, ctx: ToolContext): Promise<ToolResult> {
      const state = getState();
      const before = state.mobile.devices.length;
      state.mobile.devices = state.mobile.devices.filter((d) => d.id !== params.deviceId);
      if (state.mobile.devices.length === before) {
        return fail("Device not found.", { errorCode: "DEVICE_NOT_FOUND" });
      }
      if (state.mobile.devices.length === 0) {
        setConnection({
          mobile: "not-connected",
          details: { ...state.connections.details, mobile: "" },
        });
      }
      ctx.log({ level: "warn", source: "mobile", message: "Device disconnected." });
      return ok("Device disconnected.", { devices: state.mobile.devices.length });
    },
  });
}
