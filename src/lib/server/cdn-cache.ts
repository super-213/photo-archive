import "server-only";
import { randomUUID } from "node:crypto";
import { getDatabase } from "./database";
import { previewVariants } from "../media-settings";

export function queuePreviewCachePurge(photoId: string) {
  const url = process.env.BETTER_AUTH_URL;
  if (!url) return;
  const origin = new URL(url).origin;
  getDatabase().prepare(`INSERT INTO cdn_purge(origin,photo_id,generation) VALUES (?,?,?)
    ON CONFLICT(origin,photo_id) DO UPDATE SET generation=excluded.generation,attempts=0,next_attempt_at=0`)
    .run(origin, photoId, randomUUID());
  // Run after the caller's transaction commits; saving photo information never waits on Cloudflare.
  queueMicrotask(() => { void flushPreviewCachePurges().catch(() => console.error("[CDN] 缓存清理暂不可用，将自动重试")); });
}

type PurgeJob = { origin: string; photo_id: string; generation: string; attempts: number };
let pending: Promise<number> | undefined;
export function flushPreviewCachePurges(): Promise<number> {
  if (pending) return pending;
  pending = flush().finally(() => { pending = undefined; });
  return pending;
}

async function flush() {
  const token = process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN;
  const zone = process.env.PHOTO_ARCHIVE_CLOUDFLARE_ZONE_ID;
  if (!token || !zone) return 0;
  if (!/^[a-f0-9]{32}$/i.test(zone)) throw new Error("Cloudflare Zone ID 应为 32 位十六进制字符串");
  const db = getDatabase();
  const jobs = db.prepare("SELECT * FROM cdn_purge WHERE next_attempt_at<=? LIMIT 5").all(Date.now()) as PurgeJob[];
  let purged = 0;
  for (const job of jobs) {
    try {
      // Include the retired grid URL so caches created before the three-size migration are invalidated too.
      const files = [...previewVariants.map(({ name }) => name), "grid"].map((name) =>
        new URL(`/media/${encodeURIComponent(job.photo_id)}/${name}.webp`, job.origin).href);
      const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files }), signal: AbortSignal.timeout(10_000),
      });
      const result = await response.json() as { success?: boolean };
      if (!response.ok || result.success !== true) throw new Error(`HTTP ${response.status}`);
      db.prepare("DELETE FROM cdn_purge WHERE origin=? AND photo_id=? AND generation=?")
        .run(job.origin, job.photo_id, job.generation);
      purged++;
    } catch {
      const delay = Math.min(300_000, 5_000 * 2 ** Math.min(job.attempts, 6));
      db.prepare("UPDATE cdn_purge SET attempts=attempts+1,next_attempt_at=? WHERE origin=? AND photo_id=? AND generation=?")
        .run(Date.now() + delay, job.origin, job.photo_id, job.generation);
      console.error("[CDN] 展示图缓存清理失败，将自动重试；缓存仍按有效期失效");
    }
  }
  return purged;
}

const workerKey = Symbol.for("photo-archive.cdn-purge-worker");
export function startPreviewCachePurgeWorker() {
  const globals = globalThis as typeof globalThis & { [workerKey]?: boolean };
  if (globals[workerKey]) return;
  globals[workerKey] = true;
  async function tick() {
    try { await flushPreviewCachePurges(); }
    catch { console.error("[CDN] 缓存清理配置无效或队列暂不可用"); }
    setTimeout(tick, 10_000).unref();
  }
  setTimeout(tick, 1_000).unref();
}
