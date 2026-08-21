import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Locally we build a self-contained Node server + static client into `dist/`
// (nitro disabled), so `npm run dev` / `npm run build` / `npm run preview`
// all work out of the box. On Vercel, set NITRO_PRESET=vercel (see vercel.json)
// so the build emits a Vercel Build Output API (`.vercel/output`) with a
// Node.js serverless function for SSR + the /api/chat route.
const nitroPreset = process.env.NITRO_PRESET;
const requestedPort = Number(
  process.env.PORT ?? process.env.VITE_PORT ?? process.env.SERVER_PORT ?? 8080,
);
const localPort = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 8080;

export default defineConfig({
  vite: {
    base: "/",
    // TanStack Start serves the client, SSR, and file-route APIs from this one
    // server. strictPort prevents Vite from silently switching to another port.
    server: { host: "0.0.0.0", port: localPort, strictPort: true },
    preview: { host: "0.0.0.0", port: localPort, strictPort: true },
  },
  nitro: nitroPreset ? { preset: nitroPreset } : false,
});
