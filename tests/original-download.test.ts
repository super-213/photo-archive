import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-download-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = path.join(directory, "data");
process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
delete process.env.BETTER_AUTH_URL;
const { importPhoto, getMediaRecord, readMedia, rebuildPhotoPreviews } = await import("../src/lib/server/media");
const { originalDownloadsEnabled } = await import("../src/lib/server/media-policy");
const { cleanupDisabledOriginals, startOriginalCleanupWorker } = await import("../src/lib/server/original-cleanup");
const { getDatabase, mediaDirectory } = await import("../src/lib/server/database");
const { getPhoto, updatePhoto } = await import("../src/lib/server/store");
const { photoInput } = await import("../src/lib/server/validation");
const route = await import("../src/app/media/[id]/[variant]/route");
const { createAuth, getAuth } = await import("../src/lib/server/auth");
const origin = "http://localhost:3456";
const auth = await getAuth();
const setup = createAuth(true);
const signup = await setup.api.signUpEmail({ body: { name: "Admin", email: "download@example.test", password: "download-test-password-9381!" } });
getDatabase().prepare("INSERT INTO administrator VALUES (?)").run(signup.user.id);
const login = await auth.handler(new Request(`${origin}/api/auth/sign-in/email`, {
  method: "POST", headers: { origin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "download@example.test", password: "download-test-password-9381!" }),
}));
assert.equal(login.status, 200);
const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
const source = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#aabbcc" } })
  .withExif({ IFD0: { Model: "Download camera" } }).jpeg().toBuffer();
let photoId: string;
let originalPath: string;

after(async () => {
  getDatabase().close();
  await rm(directory, { recursive: true, force: true });
});

function request(id: string, variant = "download", options: RequestInit = {}) {
  return route.GET(new Request(`${origin}/media/${id}/${variant}`, options), { params: Promise.resolve({ id, variant }) });
}

test("the download policy defaults off and rejects misspelled booleans before cleanup", async () => {
  delete process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD;
  assert.equal(originalDownloadsEnabled(), false);
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "ture";
  assert.throws(originalDownloadsEnabled, /true 或 false/);
  await assert.rejects(cleanupDisabledOriginals(), /true 或 false/);
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
});

test("enabled imports retain byte-exact originals and expose downloads without public caching", async () => {
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "true";
  const { photo } = await importPhoto(source, "可下载照片.jpg", { visibility: "public" });
  photoId = photo.id;
  assert.equal(photo.downloadSrc, `/media/${photoId}/download`);
  const original = getMediaRecord(photoId, "original")!;
  originalPath = path.join(mediaDirectory, original.storage_key, original.filename);
  assert.deepEqual(await readFile(originalPath), source);
  assert.deepEqual((await readdir(path.dirname(originalPath))).sort(), ["lightbox.webp", "original.jpg", "preview.webp", "thumbnail.webp"]);
  assert.equal(await rebuildPhotoPreviews(photoId), false);
  assert.deepEqual(await cleanupDisabledOriginals(), { cleaned: 0, failed: 0 });
  for (const variant of ["download", "original"]) {
    const response = await request(photoId, variant, { headers: { "if-none-match": "*" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.match(response.headers.get("content-disposition")!, /^attachment;/);
    assert.ok(response.headers.get("content-disposition")!.includes(encodeURIComponent("可下载照片.jpg")));
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  }
  const head = await request(photoId, "download", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.equal(Number(head.headers.get("content-length")), source.length);
  const range = await request(photoId, "download", { headers: { range: "bytes=10-49" } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), source.subarray(10, 50));
});

test("draft and private downloads require administrator authentication", async () => {
  const before = getPhoto(photoId)!;
  for (const visibility of ["draft", "private"] as const) {
    updatePhoto(photoId, photoInput.parse({ ...getPhoto(photoId), visibility }));
    for (const method of ["GET", "HEAD"]) {
      assert.equal((await request(photoId, "download", { method })).status, 404);
      const response = await request(photoId, "download", { method, headers: { cookie, host: "localhost:3456" } });
      assert.equal(response.status, 200);
      if (method === "GET") assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
    }
  }
  updatePhoto(photoId, photoInput.parse({ ...getPhoto(photoId), visibility: before.visibility }));
});

test("switching off immediately blocks downloads and automatically cleans existing originals", async (t) => {
  const previews = await Promise.all(["thumbnail", "preview", "lightbox"].map((variant) => readMedia(getMediaRecord(photoId, variant)!)));
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
  assert.equal(getPhoto(photoId)!.downloadSrc, undefined);
  assert.equal((await request(photoId)).status, 404);
  assert.equal((await request(photoId, "original", { method: "HEAD", headers: { cookie } })).status, 404);
  // Drive the same initial timer installed by server instrumentation without waiting in real time.
  let runCleanup: (() => Promise<void>) | undefined;
  t.mock.method(globalThis, "setTimeout", (callback: () => Promise<void>) => {
    runCleanup ||= callback;
    return { unref() {} };
  });
  startOriginalCleanupWorker();
  assert.ok(runCleanup);
  await runCleanup();
  assert.equal(getMediaRecord(photoId, "original"), undefined);
  await assert.rejects(readFile(originalPath), { code: "ENOENT" });
  for (const [index, variant] of ["thumbnail", "preview", "lightbox"].entries())
    assert.deepEqual(await readMedia(getMediaRecord(photoId, variant)!), previews[index]);
});

test("switching back on downloads the largest existing image and reimports restore the original", async () => {
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "true";
  const lightbox = await readMedia(getMediaRecord(photoId, "lightbox")!);
  const response = await request(photoId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.match(response.headers.get("content-disposition")!, /\.webp/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), lightbox);
  assert.equal(getMediaRecord(photoId, "original"), undefined);
  const previous = getPhoto(photoId)!;
  const duplicate = await importPhoto(source, "再次导入.jpg");
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.photo, previous);
  assert.deepEqual(await readMedia(getMediaRecord(photoId, "original")!), source);
  assert.deepEqual(Buffer.from(await (await request(photoId)).arrayBuffer()), source);
});

test("disabled new imports have no originals and later use the largest remaining file if lightbox is absent", async () => {
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
  const bytes = await sharp(source).resize(1900).png().toBuffer();
  const { photo } = await importPhoto(bytes, "无原图.png", { visibility: "public" });
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  assert.equal(photo.downloadSrc, undefined);
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "true";
  const lightbox = getMediaRecord(photo.id, "lightbox")!;
  await rm(path.join(mediaDirectory, lightbox.storage_key, lightbox.filename));
  const response = await request(photo.id);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readMedia(getMediaRecord(photo.id, "preview")!));
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
});

test("cleanup retains originals when repairs fail and retries after the source is repaired", async () => {
  // Use a unique photo and simulate a corrupt legacy source plus a missing display.
  const bytes = await sharp(source).resize(1800).jpeg().toBuffer();
  const { photo } = await importPhoto(bytes, "需修复.jpg");
  const original = getMediaRecord(photo.id, "original")!;
  const filename = path.join(mediaDirectory, original.storage_key, original.filename);
  const thumbnail = getMediaRecord(photo.id, "thumbnail")!;
  await writeFile(filename, "invalid source");
  await rm(path.join(mediaDirectory, thumbnail.storage_key, thumbnail.filename));
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
  assert.equal((await cleanupDisabledOriginals()).failed, 1);
  assert.ok(getMediaRecord(photo.id, "original"));
  assert.equal(await readFile(filename, "utf8"), "invalid source");
  await writeFile(filename, bytes);
  assert.equal((await cleanupDisabledOriginals()).failed, 0);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  await assert.rejects(readFile(filename), { code: "ENOENT" });
  assert.ok((await readMedia(getMediaRecord(photo.id, "thumbnail")!)).length > 0);
});

test("downloads handle stale original records and choose actual dimensions over variant names", async () => {
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "true";
  const bytes = await sharp(source).resize(1700).jpeg().toBuffer();
  const { photo } = await importPhoto(bytes, "缺失原件.jpg", { visibility: "public" });
  const original = getMediaRecord(photo.id, "original")!;
  await rm(path.join(mediaDirectory, original.storage_key, original.filename));
  const response = await request(photo.id);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readMedia(getMediaRecord(photo.id, "lightbox")!));
  // A legacy file may be larger than the name of its registered variant suggests.
  const preview = getMediaRecord(photo.id, "preview")!;
  const largest = await sharp(source).webp().toBuffer();
  await writeFile(path.join(mediaDirectory, preview.storage_key, preview.filename), largest);
  assert.deepEqual(Buffer.from(await (await request(photo.id)).arrayBuffer()), largest);
  assert.equal((await request(photo.id, "download", { headers: { range: "bytes=999999999-" } })).status, 416);
});

test("enabled folder imports retain originals before automatically deleting their source files", async () => {
  process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "true";
  const inbox = path.join(directory, "imports");
  await mkdir(inbox);
  const bytes = await sharp(source).resize(1600).jpeg().toBuffer();
  const filename = path.join(inbox, "文件夹照片.jpg");
  await writeFile(filename, bytes);
  const { createFolderImporter, getFolderImportStatus } = await import("../src/lib/server/folder-import");
  const importer = createFolderImporter({ directory: inbox, settleMs: 0 });
  await importer.scan();
  await importer.scan();
  const imported = getFolderImportStatus(inbox).recent.find((entry) => entry.file === "文件夹照片.jpg")!;
  assert.equal(imported.status, "imported");
  assert.deepEqual(await readMedia(getMediaRecord(imported.photoId!, "original")!), bytes);
  await assert.rejects(readFile(filename), { code: "ENOENT" });
  assert.ok(getPhoto(imported.photoId!)!.downloadSrc);
});
