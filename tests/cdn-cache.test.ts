import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-cdn-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
process.env.BETTER_AUTH_URL = "https://photos.example.test";
delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN;
delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_ZONE_ID;
delete process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR;
delete process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE;
const { importPhoto, rebuildPhotoPreviews } = await import("../src/lib/server/media");
const { getPhoto, updatePhoto } = await import("../src/lib/server/store");
const { photoInput } = await import("../src/lib/server/validation");
const { getDatabase } = await import("../src/lib/server/database");
const { flushPreviewCachePurges, queuePreviewCachePurge } = await import("../src/lib/server/cdn-cache");
const { previewVariants } = await import("../src/lib/media-settings");
const mediaRoute = await import("../src/app/media/[id]/[variant]/route");
const image = await sharp({ create: { width: 64, height: 48, channels: 3, background: "blue" } }).jpeg().toBuffer();
const photo = (await importPhoto(image, "public.jpg")).photo;
const db = getDatabase();
const rows = () => db.prepare("SELECT * FROM cdn_purge").all() as { generation: string; attempts: number; next_attempt_at: number }[];
const originalFetch = globalThis.fetch;
after(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN;
  delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_ZONE_ID;
  await flushPreviewCachePurges();
  db.close();
  await rm(directory, { recursive: true, force: true });
});

async function get(variant: string, query = "", headers: HeadersInit = {}) {
  return mediaRoute.GET(new Request(`https://photos.example.test/media/${photo.id}/${variant}${query}`, { headers }), {
    params: Promise.resolve({ id: photo.id, variant }),
  });
}

test("only public canonical WebP previews advertise shared caching; legacy and query URLs remain private", async () => {
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id), visibility: "public" }));
  const current = getPhoto(photo.id)!;
  assert.equal(current.src, `/media/${photo.id}/preview.webp`);
  for (const { name } of previewVariants) {
    const response = await get(`${name}.webp`, "", { cookie: "unrelated=value" });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=14400");
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "public, max-age=14400, must-revalidate");
    assert.doesNotMatch(response.headers.get("vary") || "", /cookie/i);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-type"), "image/webp");
    await response.arrayBuffer();
  }
  for (const [variant, query] of [["grid", ""], ["grid.webp", ""], ["preview.webp", "?unexpected=value"]]) {
    const response = await get(variant, query);
    assert.equal(response.headers.get("cache-control"), "private, no-cache");
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    await response.arrayBuffer();
  }
  const first = await get("preview.webp");
  const etag = first.headers.get("etag")!;
  await first.arrayBuffer();
  const cached = await get("preview.webp", "", { "if-none-match": etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get("cache-control"), "private, max-age=14400");
  assert.equal(cached.headers.get("cloudflare-cdn-cache-control"), "public, max-age=14400, must-revalidate");
});

test("originals, downloads, invalid variants and revoked previews never advertise shared caching", async () => {
  for (const variant of ["original", "original.webp", "download", "download.webp", "grid.webp.webp", "missing.webp"]) {
    const response = await get(variant);
    assert.equal(response.status, variant === "original" ? 200 : 404);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    await response.arrayBuffer();
  }
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id), visibility: "private" }));
  await flushPreviewCachePurges();
  for (const { name } of previewVariants) {
    const response = await get(`${name}.webp`, "", { "if-none-match": "*" });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.equal(rows().length, 1, "withdrawal persists invalidation even without credentials");
});

test("purge targets current displays plus the retired grid URL and retries without losing jobs", async (t) => {
  process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN = "test-token";
  process.env.PHOTO_ARCHIVE_CLOUDFLARE_ZONE_ID = "a".repeat(32);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), `https://api.cloudflare.com/client/v4/zones/${"a".repeat(32)}/purge_cache`);
    const { files } = JSON.parse(String(options?.body));
    assert.deepEqual(files, [...previewVariants.map(({ name }) => name), "grid"].map((name) => `https://photos.example.test/media/${photo.id}/${name}.webp`));
    assert.ok(files.every((file: string) => !/original|download/.test(file)));
    calls++;
    return Response.json({ success: calls > 1 }, { status: calls === 1 ? 429 : 200 });
  });
  assert.equal(await flushPreviewCachePurges(), 0);
  assert.equal(rows()[0].attempts, 1);
  assert.ok(rows()[0].next_attempt_at > Date.now());
  db.prepare("UPDATE cdn_purge SET next_attempt_at=0").run();
  assert.equal(await flushPreviewCachePurges(), 1);
  assert.equal(rows().length, 0);
});

test("an invalidation queued during an in-flight purge is retained for the next purge", async (t) => {
  delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN;
  queuePreviewCachePurge(photo.id);
  await flushPreviewCachePurges();
  process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN = "test-token";
  let release!: (response: Response) => void;
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => { release = resolve; }));
  const flushing = flushPreviewCachePurges();
  const previous = rows()[0].generation;
  queuePreviewCachePurge(photo.id);
  assert.notEqual(rows()[0].generation, previous);
  release(Response.json({ success: true }));
  await flushing;
  assert.equal(rows().length, 1);
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true }));
  await flushPreviewCachePurges();
  assert.equal(rows().length, 0);
});

test("rebuilding public previews queues invalidation", async () => {
  delete process.env.PHOTO_ARCHIVE_CLOUDFLARE_API_TOKEN;
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id), visibility: "public" }));
  process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "Updated copyright";
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  await flushPreviewCachePurges();
  assert.equal(rows().length, 1);
});
