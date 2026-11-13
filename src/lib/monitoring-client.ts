import { monitoringPath, type TelemetryEvent } from "./monitoring";

export function sendTelemetry(event: TelemetryEvent) {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const body = JSON.stringify(event);
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/telemetry", { method: "POST", body, keepalive: true,
      credentials: "omit", headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch { /* Monitoring must never interrupt browsing or error recovery. */ }
}

const reported = new WeakSet<object>();
let errorsSent = 0;
export function reportClientError(error: unknown, source: "client-error" | "unhandled-rejection" | "render-error") {
  try {
    if (errorsSent >= 10) return;
    if (typeof error === "object" && error !== null) {
      if (reported.has(error)) return;
      reported.add(error);
    }
    errorsSent++;
    const name = error instanceof Error && ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError"].includes(error.name)
      ? error.name as "Error" | "TypeError" | "RangeError" | "ReferenceError" | "SyntaxError" : "OtherError";
    const rawDigest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : "";
    sendTelemetry({ kind: "error", id: crypto.randomUUID(), path: monitoringPath(location.pathname),
      source, name, digest: /^[a-zA-Z0-9_-]{0,128}$/.test(rawDigest) ? rawDigest : "" });
  } catch { /* Ignore telemetry failures, including inaccessible error properties. */ }
}
