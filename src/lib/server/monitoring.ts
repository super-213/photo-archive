import "server-only";
import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { monitoringPath, vitalNames, vitalRating, type TelemetryEvent, type VitalName } from "../monitoring";

export const monitoringRetentionMs = 7 * 24 * 60 * 60 * 1000;
export const monitoringMaxEvents = 20_000;
type ServerErrorEvent = { kind: "error"; id: string; path: string; name: string; source: "server-error"; digest: string };
type EventRow = { kind: "vital" | "error"; path: string; name: string; value: number | null; source: string; digest: string; recorded_at: number };

function prune(now: number) {
  const db = getDatabase();
  db.prepare("DELETE FROM telemetry_event WHERE recorded_at < ?").run(now - monitoringRetentionMs);
  db.prepare("DELETE FROM telemetry_event WHERE seq <= (SELECT MAX(seq) FROM telemetry_event) - ?").run(monitoringMaxEvents);
}

export function recordTelemetry(event: TelemetryEvent | ServerErrorEvent, now = Date.now()) {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`INSERT INTO telemetry_event(event_id,kind,path,name,value,source,digest,recorded_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET value=excluded.value`)
      .run(`${event.kind}:${event.name}:${event.id}`, event.kind, monitoringPath(event.path), event.name,
        event.kind === "vital" ? event.value : null, event.kind === "error" ? event.source : "",
        event.kind === "error" ? event.digest : "", now);
    prune(now);
  })();
}

export function recordServerError(error: unknown, path: string) {
  try {
    const rawDigest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : "";
    recordTelemetry({ kind: "error", id: randomUUID(), path, name: "Error", source: "server-error",
      digest: /^[a-zA-Z0-9_-]{0,128}$/.test(rawDigest) ? rawDigest : "" });
  } catch {
    // A broken database must not make the original error handler fail recursively.
    console.error("[运行监测] 服务端错误记录失败");
  }
}

export function monitoringSummary(now = Date.now()) {
  prune(now);
  const rows = getDatabase().prepare("SELECT kind,path,name,value,source,digest,recorded_at FROM telemetry_event WHERE recorded_at >= ? ORDER BY recorded_at DESC, seq DESC")
    .all(now - monitoringRetentionMs) as EventRow[];
  function summarize(samples: EventRow[]) {
    return vitalNames.map((name) => {
      const values = samples.filter((row) => row.kind === "vital" && row.name === name && row.value !== null)
        .map((row) => row.value!).sort((a, b) => a - b);
      const p75 = values.length ? values[Math.ceil(values.length * 0.75) - 1] : null;
      return { name, count: values.length, p75, rating: p75 === null ? null : vitalRating(name, p75) };
    });
  }
  const vitals = rows.filter((row) => row.kind === "vital");
  const errors = rows.filter((row) => row.kind === "error");
  return {
    metrics: summarize(vitals), totalSamples: vitals.length, totalErrors: errors.length,
    paths: [...new Set(vitals.map((row) => row.path))].sort().map((path) => ({ path, metrics: summarize(vitals.filter((row) => row.path === path)) })),
    recentErrors: errors.slice(0, 30),
    lastReceived: rows[0]?.recorded_at ?? null,
  };
}

export function formatVital(name: VitalName, value: number | null) {
  return value === null ? "暂无数据" : name === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`;
}
