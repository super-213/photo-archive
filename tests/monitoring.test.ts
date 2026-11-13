import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitoringPath } from "../src/lib/monitoring";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-archive-monitoring-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
delete process.env.PHOTO_ARCHIVE_SITE_URL;
delete process.env.BETTER_AUTH_URL;
const { getDatabase } = await import("../src/lib/server/database");
const { recordTelemetry, recordServerError, monitoringSummary, monitoringRetentionMs, monitoringMaxEvents } = await import("../src/lib/server/monitoring");
const { POST } = await import("../src/app/api/telemetry/route");
const db = getDatabase();
after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
const endpoint = "http://localhost:3000/api/telemetry";
function request(body: unknown, origin = "http://localhost:3000") {
  return new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body) });
}
const vital = { kind: "vital", id: "test-load", name: "LCP", value: 1000, path: "/works/secret-name?token=secret#photo" };

test("telemetry accepts same-origin, validates payloads, strips sensitive fields and deduplicates metric updates", async () => {
  assert.equal((await POST(request({ ...vital, cookie: "secret", message: "secret" }))).status, 204);
  assert.equal((await POST(request({ ...vital, value: 2800 }))).status, 204);
  const rows = db.prepare("SELECT * FROM telemetry_event").all();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { value: number }).value, 2800);
  assert.equal((rows[0] as { path: string }).path, "/works/[slug]");
  assert.ok(!JSON.stringify(rows).includes("secret"));
  assert.equal((await POST(request(vital, "https://evil.example"))).status, 403);
  assert.equal((await POST(request(vital, ""))).status, 403);
  for (const body of [{ ...vital, value: -1 }, { ...vital, value: null }, { ...vital, name: "fake" }, { ...vital, kind: "error", source: "server-error" }])
    assert.equal((await POST(request(body))).status, 400);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { origin: "http://localhost:3000" }, body: "{" }))).status, 400);
  assert.equal((await POST(request({ ...vital, padding: "x".repeat(5000) }))).status, 413);
  assert.equal((await POST(request({ ...vital, id: "admin", path: "/admin/photos" }))).status, 204);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_event").get() as { count: number }).count, 1);
});

test("a separately configured SEO origin can report while forged hosts and origins cannot", async () => {
  process.env.PHOTO_ARCHIVE_SITE_URL = "https://gallery.example.test";
  const post = (host: string, origin: string) => POST(new Request("http://localhost:3000/api/telemetry", {
    method: "POST", headers: { host, origin }, body: JSON.stringify({ ...vital, id: "public-host" }),
  }));
  assert.equal((await post("gallery.example.test", "https://gallery.example.test")).status, 204);
  assert.equal((await post("evil.example", "https://gallery.example.test")).status, 403);
  assert.equal((await post("gallery.example.test", "https://evil.example")).status, 403);
  delete process.env.PHOTO_ARCHIVE_SITE_URL;
});

test("P75 uses distinct updated samples; retention and error summaries do not expose raw error messages", () => {
  db.exec("DELETE FROM telemetry_event");
  const now = Date.now();
  [1000, 2000, 3000, 4000].forEach((value, index) => recordTelemetry({ kind: "vital", id: `lcp-${index}`, path: "/", name: "LCP", value }, now));
  recordTelemetry({ kind: "vital", id: "old", path: "/archive", name: "CLS", value: 0.1 }, now - monitoringRetentionMs - 1);
  recordServerError(Object.assign(new Error("secret database credential"), { digest: "12345" }), "/admin/projects/private-id?password=secret");
  const summary = monitoringSummary(now);
  assert.equal(summary.metrics.find((metric) => metric.name === "LCP")?.p75, 3000);
  assert.equal(summary.metrics.find((metric) => metric.name === "LCP")?.rating, "needs-improvement");
  assert.equal(summary.metrics.find((metric) => metric.name === "INP")?.p75, null);
  assert.equal(summary.totalSamples, 4);
  assert.equal(summary.totalErrors, 1);
  assert.equal(summary.recentErrors[0].path, "/admin/projects/[id]");
  assert.equal(summary.recentErrors[0].digest, "12345");
  assert.ok(!JSON.stringify(summary).includes("secret"));
  assert.equal(monitoringPath("/unknown?password=secret"), "/other");
  assert.equal(monitoringPath("/api/admin/photos/private-id"), "/api/admin/[route]");
});

test("stored telemetry stays bounded and public ingestion is rate-limited", async () => {
  db.exec("DELETE FROM telemetry_event");
  const insert = db.prepare("INSERT INTO telemetry_event(event_id,kind,path,name,value,recorded_at) VALUES (?,'vital','/','CLS',0,?)");
  db.transaction(() => { for (let index = 0; index < monitoringMaxEvents + 5; index++) insert.run(`cap-${index}`, Date.now()); })();
  recordTelemetry({ kind: "vital", id: "after-cap", path: "/", name: "CLS", value: 0 });
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM telemetry_event").get() as { count: number }).count, monitoringMaxEvents);
  let response: Response | undefined;
  for (let index = 0; index < 1201; index++) {
    response = await POST(request({ ...vital, id: "rate-limit", path: "/admin/photos" }));
    if (response.status === 429) break;
  }
  assert.equal(response?.status, 429);
  assert.equal(response?.headers.get("retry-after"), "60");
});
