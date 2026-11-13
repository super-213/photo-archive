import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-sizes-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "测试作者";
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "测试版权";
delete process.env.BETTER_AUTH_URL;
const { importPhoto, getMediaRecord, readMedia, rebuildPhotoPreviews } = await import("../src/lib/server/media");
const { getDatabase, mediaDirectory } = await import("../src/lib/server/database");
const { getPhoto, updatePhoto } = await import("../src/lib/server/store");
const { photoInput } = await import("../src/lib/server/validation");
const { photoSources } = await import("../src/lib/photo-sources");
const mediaRoute = await import("../src/app/media/[id]/[variant]/route");
const source = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#ccaa88" } }).jpeg().toBuffer();
const { photo } = await importPhoto(source, "精简照片.jpg", { visibility: "public" });
after(async () => {
  getDatabase().close();
  await rm(directory, { recursive: true, force: true });
});

test("new imports store exactly three display sizes; ordinary pages never select the lightbox image", () => {
  assert.deepEqual(getDatabase().prepare("SELECT variant FROM media_variant WHERE photo_id=? ORDER BY variant").all(photo.id),
    ["lightbox", "preview", "thumbnail"].map((variant) => ({ variant })));
  assert.equal(photo.src, photo.previewSrc);
  const normal = photoSources(photo);
  assert.equal(normal.srcSet, `${photo.thumbnailSrc} 280w, ${photo.previewSrc} 560w`);
  assert.doesNotMatch(normal.srcSet!, /lightbox|grid/);
  assert.equal(photoSources(photo, "lightbox").srcSet,
    `${photo.thumbnailSrc} 280w, ${photo.previewSrc} 560w, ${photo.lightboxSrc} 1200w`);
  assert.equal(photoSources({ ...photo, width: 100, height: 50 }).srcSet, `${photo.thumbnailSrc} 100w`);
  assert.deepEqual(photoSources({ ...photo, previewSrc: undefined }), { src: photo.src, srcSet: undefined });
});

test("retiring legacy media removes originals and grid only after displays are complete and preserves edited metadata", async () => {
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id), title: "手动标题", tags: ["保留"] }));
  const before = getPhoto(photo.id)!;
  const display = getMediaRecord(photo.id, "lightbox")!;
  const original = path.join(mediaDirectory, display.storage_key, "original.jpg");
  await writeFile(original, source);
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'original','original.jpg','image/jpeg')").run(photo.id);
  const preview = await readMedia(getMediaRecord(photo.id, "preview")!);
  const grid = path.join(mediaDirectory, display.storage_key, "grid.webp");
  await writeFile(grid, await sharp(source).resize(1440).webp().toBuffer());
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'grid','grid.webp','image/webp')").run(photo.id);
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.equal(await rebuildPhotoPreviews(photo.id), false);
  assert.equal(getMediaRecord(photo.id, "grid"), undefined);
  await assert.rejects(readFile(grid), { code: "ENOENT" });
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  await assert.rejects(readFile(original), { code: "ENOENT" });
  assert.deepEqual((await readdir(path.dirname(original))).sort(), ["lightbox.webp", "preview.webp", "thumbnail.webp"]);
  assert.equal(getMediaRecord(photo.id, "download"), undefined);
  assert.deepEqual(await readMedia(getMediaRecord(photo.id, "preview")!), preview);
  assert.deepEqual(getPhoto(photo.id), before);
  for (const variant of ["grid", "grid.webp"]) {
    const response = await mediaRoute.GET(new Request(`http://localhost/media/${photo.id}/${variant}`), {
      params: Promise.resolve({ id: photo.id, variant }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), preview);
  }
});

test("missing smaller displays are repaired from lightbox without altering its compressed bytes", async () => {
  const lightbox = getMediaRecord(photo.id, "lightbox")!;
  const before = await readMedia(lightbox);
  const thumbnail = getMediaRecord(photo.id, "thumbnail")!;
  await rm(path.join(mediaDirectory, thumbnail.storage_key, thumbnail.filename));
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.equal(await rebuildPhotoPreviews(photo.id), false);
  assert.deepEqual(await readMedia(lightbox), before);
  const metadata = await sharp(await readMedia(getMediaRecord(photo.id, "thumbnail")!)).metadata();
  assert.equal(metadata.height, 420);
  assert.equal(metadata.width, 280);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
});

test("a missing lightbox requires a matching source reimport and preserves manual metadata", async () => {
  const before = getPhoto(photo.id)!;
  const lightbox = getMediaRecord(photo.id, "lightbox")!;
  await rm(path.join(mediaDirectory, lightbox.storage_key, lightbox.filename));
  await assert.rejects(rebuildPhotoPreviews(photo.id), /重新导入源照片/);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  const result = await importPhoto(source, "重新导入.jpg");
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.photo, before);
  assert.equal(await rebuildPhotoPreviews(photo.id), false);
  assert.ok((await readMedia(getMediaRecord(photo.id, "lightbox")!)).length > 0);
});

test("failed legacy conversion leaves the original file and record available for retry", async () => {
  const lightbox = getMediaRecord(photo.id, "lightbox")!;
  const original = path.join(mediaDirectory, lightbox.storage_key, "original.jpg");
  const thumbnail = getMediaRecord(photo.id, "thumbnail")!;
  const filename = path.join(mediaDirectory, thumbnail.storage_key, thumbnail.filename);
  const bytes = await readFile(filename);
  await writeFile(original, "invalid source");
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'original','original.jpg','image/jpeg')").run(photo.id);
  await rm(filename);
  await assert.rejects(rebuildPhotoPreviews(photo.id));
  assert.equal(await readFile(original, "utf8"), "invalid source");
  assert.ok(getMediaRecord(photo.id, "original"));
  assert.ok(!(await readdir(path.dirname(original))).some((name) => name.startsWith(".previews-")));
  await writeFile(original, source);
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  await assert.rejects(readFile(original), { code: "ENOENT" });
  assert.deepEqual(await readFile(filename), bytes);
});

test("a corrupt legacy display is repaired before deleting its original", async () => {
  const lightbox = getMediaRecord(photo.id, "lightbox")!;
  const original = path.join(mediaDirectory, lightbox.storage_key, "original.jpg");
  const filename = path.join(mediaDirectory, lightbox.storage_key, lightbox.filename);
  const before = await readFile(filename);
  const truncated = before.subarray(0, Math.floor(before.length / 2));
  await assert.rejects(sharp(truncated).stats());
  await writeFile(filename, truncated);
  await writeFile(original, source);
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'original','original.jpg','image/jpeg')").run(photo.id);
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.deepEqual(await readFile(filename), before);
  assert.equal(getMediaRecord(photo.id, "original"), undefined);
  await assert.rejects(readFile(original), { code: "ENOENT" });
});
