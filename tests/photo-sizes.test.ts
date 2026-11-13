import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-sizes-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
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
    ["download", "lightbox", "original", "preview", "thumbnail"].map((variant) => ({ variant })));
  assert.equal(photo.src, photo.previewSrc);
  const normal = photoSources(photo);
  assert.equal(normal.srcSet, `${photo.thumbnailSrc} 280w, ${photo.previewSrc} 560w`);
  assert.doesNotMatch(normal.srcSet!, /lightbox|grid/);
  assert.equal(photoSources(photo, "lightbox").srcSet,
    `${photo.thumbnailSrc} 280w, ${photo.previewSrc} 560w, ${photo.lightboxSrc} 1200w`);
  assert.equal(photoSources({ ...photo, width: 100, height: 50 }).srcSet, `${photo.thumbnailSrc} 100w`);
  assert.deepEqual(photoSources({ ...photo, previewSrc: undefined }), { src: photo.src, srcSet: undefined });
});

test("retiring a legacy grid removes only the derived file and preserves all originals and edited metadata", async () => {
  updatePhoto(photo.id, photoInput.parse({ ...getPhoto(photo.id), title: "手动标题", tags: ["保留"] }));
  const before = getPhoto(photo.id)!;
  const original = getMediaRecord(photo.id, "original")!;
  const download = await readMedia(getMediaRecord(photo.id, "download")!);
  const preview = await readMedia(getMediaRecord(photo.id, "preview")!);
  const grid = path.join(mediaDirectory, original.storage_key, "grid.webp");
  await writeFile(grid, await sharp(source).resize(1440).webp().toBuffer());
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'grid','grid.webp','image/webp')").run(photo.id);
  assert.equal(await rebuildPhotoPreviews(photo.id), true);
  assert.equal(await rebuildPhotoPreviews(photo.id), false);
  assert.equal(getMediaRecord(photo.id, "grid"), undefined);
  await assert.rejects(readFile(grid), { code: "ENOENT" });
  assert.deepEqual(await readMedia(original), source);
  assert.deepEqual(await readMedia(getMediaRecord(photo.id, "download")!), download);
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
