// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// Node-only lifecycle diagnostics. `uncaughtExceptionMonitor` observes errors
// without changing Node's normal crash behavior.
if (typeof process !== "undefined") {
  process.on("uncaughtExceptionMonitor", (error) => {
    record(error);
    console.error("ERROR", error);
    console.error("STACK TRACE", error.stack);
  });
  process.on("unhandledRejection", (reason) => {
    record(reason);
    console.error("ERROR", reason);
    console.error("STACK TRACE", reason instanceof Error ? reason.stack : undefined);
  });
  process.on("exit", (code) => {
    console.info(JSON.stringify({ event: "process_exit", message: "PROCESS EXIT", code }));
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
