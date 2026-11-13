import assert from "node:assert/strict";
import { after, test } from "node:test";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-copyright-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
process.env.PHOTO_ARCHIVE_ORIGINAL_DOWNLOAD = "false";
const copyrightAuthor = "测试作者 & 工作室";
const copyrightNotice = "© 测试作者 & 工作室 保留所有权利";
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
const { importPhoto, getMediaRecord, readMedia, rebuildPhotoPreviews } =
  await import("../src/lib/server/media");
const { getDatabase, mediaDirectory } = await import("../src/lib/server/database");
const { getPhoto, updatePhoto } = await import("../src/lib/server/store");
const { photoInput } = await import("../src/lib/server/validation");
const mediaRoute = await import("../src/app/media/[id]/[variant]/route");
const { previewVariants } = await import("../src/lib/media-settings");
const run = promisify(execFile);
const exiftoolPath: string = createRequire(import.meta.url)("exiftool-vendored.pl");
after(async () => {
  getDatabase().close();
  await rm(directory, { recursive: true, force: true });
});

async function readTags(id: string, variant: string) {
  const record = getMediaRecord(id, variant)!;
  const { stdout } = await run(exiftoolPath, [
    "-json", "-G1", "-s", "-Artist", "-Copyright", "-Creator", "-Rights",
    "-Make", "-Model", "-GPSLatitude", "-DateTimeOriginal",
    path.join(mediaDirectory, record.storage_key, record.filename),
  ]);
  return JSON.parse(stdout)[0] as Record<string, unknown>;
}

async function assertDisplayFilesOnly(id: string) {
  const record = getMediaRecord(id, "lightbox")!;
  assert.deepEqual((await readdir(path.join(mediaDirectory, record.storage_key))).sort(),
    ["lightbox.webp", "preview.webp", "thumbnail.webp"]);
  assert.equal(getMediaRecord(id, "original"), undefined);
  assert.equal(getMediaRecord(id, "download"), undefined);
}

function webpImageData(bytes: Buffer) {
  const chunks: Buffer[] = [];
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (["VP8 ", "VP8L", "ALPH", "ICCP"].includes(type)) chunks.push(bytes.subarray(offset, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  return Buffer.concat(chunks);
}

const pixels = Buffer.alloc(640 * 400 * 3);
for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 31 + Math.floor(index / 17)) % 256;
const jpeg = await sharp(pixels, { raw: { width: 640, height: 400, channels: 3 } })
  .withExif({
    IFD0: { Artist: "Camera author", Copyright: "Camera copyright", Make: "Camera brand", Model: "Camera model" },
    IFD2: { DateTimeOriginal: "2024:05:06 07:08:09" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 12/1 0/1" },
  }).withIccProfile("p3").jpeg({ quality: 95 }).toBuffer();
let id = "";

test("display files contain exact Unicode copyright and exclude source camera and GPS metadata", async () => {
  id = (await importPhoto(jpeg, "作品.jpg")).photo.id;
  for (const variant of previewVariants) {
    const tags = await readTags(id, variant.name);
    assert.equal(tags["XMP-dc:Creator"], copyrightAuthor);
    assert.equal(tags["XMP-dc:Rights"], copyrightNotice);
    assert.equal(tags["GPS:GPSLatitude"], undefined);
    assert.equal(tags["IFD0:Model"], undefined);
  }
});

test("only displays remain and original/download HTTP requests stay disabled", async () => {
  await assertDisplayFilesOnly(id);
  const photo = getPhoto(id)!;
  updatePhoto(id, photoInput.parse({ ...photo, visibility: "public" }));
  for (const variant of ["original", "original.jpg", "download", "download.jpg"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await mediaRoute.GET(new Request(`http://localhost/media/${id}/${variant}`, { method }), {
        params: Promise.resolve({ id, variant }),
      });
      assert.equal(response.status, 404);
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    }
  }
  assert.equal(await rebuildPhotoPreviews(id), false);
});

test("display streams support HEAD, invalid ranges, cancellation and aborted requests", async () => {
  const url = `http://localhost/media/${id}/preview.webp`;
  const context = { params: Promise.resolve({ id, variant: "preview.webp" }) };
  const head = await mediaRoute.HEAD(new Request(url, { method: "HEAD" }), context);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.ok(Number(head.headers.get("content-length")) > 0);
  await assertDisplayFilesOnly(id);
  const invalid = await mediaRoute.GET(new Request(url, { headers: { range: "bytes=999999999-" } }), context);
  assert.equal(invalid.status, 416);
  await assertDisplayFilesOnly(id);
  const canceled = await mediaRoute.GET(new Request(url), context);
  assert.equal(canceled.status, 200);
  await canceled.body!.cancel();
  await assertDisplayFilesOnly(id);
  const controller = new AbortController();
  const aborted = await mediaRoute.GET(new Request(url, { signal: controller.signal }), context);
  controller.abort();
  await aborted.body!.cancel();
  await assertDisplayFilesOnly(id);
});

test("rebuilding retires legacy download copies without rewriting valid displays", async () => {
  const record = getMediaRecord(id, "lightbox")!;
  const filename = path.join(mediaDirectory, record.storage_key, "download.jpg");
  const preview = await readMedia(getMediaRecord(id, "preview")!);
  await writeFile(filename, jpeg);
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'download','download.jpg','image/jpeg')").run(id);
  assert.equal(await rebuildPhotoPreviews(id), true);
  assert.equal(await rebuildPhotoPreviews(id), false);
  assert.deepEqual(await readMedia(getMediaRecord(id, "preview")!), preview);
  await assertDisplayFilesOnly(id);
});

test("third-party sample photos retain their source attribution", async () => {
  const source = await sharp(jpeg).resize(320).withExif({ IFD0: { Artist: "Sample author", Copyright: "Sample copyright" } }).jpeg().toBuffer();
  const sample = (await importPhoto(source, "sample.jpg", { isSample: true })).photo;
  assert.equal(getMediaRecord(sample.id, "download"), undefined);
  await assertDisplayFilesOnly(sample.id);
  const tags = await readTags(sample.id, "preview");
  assert.notEqual(tags["XMP-dc:Rights"], copyrightNotice);
  assert.equal(getPhoto(sample.id)!.isSample, true);
  const before = await readMedia(getMediaRecord(sample.id, "preview")!);
  assert.equal(await rebuildPhotoPreviews(sample.id), false);
  assert.deepEqual(await readMedia(getMediaRecord(sample.id, "preview")!), before);
});

test("changing copyright configuration refreshes cached media automatically", async () => {
  const previousPreview = getMediaRecord(id, "preview")!;
  const before = await Promise.all(previewVariants.map(async ({ name }) => webpImageData(await readMedia(getMediaRecord(id, name)!))));
  try {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "另一个作者";
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "© 另一个作者 <作品集>";
    assert.equal(await rebuildPhotoPreviews(id), true);
    assert.equal(getMediaRecord(id, "download"), undefined);
    assert.notEqual(getMediaRecord(id, "preview")!.encoding_version, previousPreview.encoding_version);
    for (const [index, variant] of previewVariants.entries()) {
      const tags = await readTags(id, variant.name);
      assert.deepEqual(webpImageData(await readMedia(getMediaRecord(id, variant.name)!)), before[index]);
      assert.equal(tags["XMP-dc:Creator"], "另一个作者");
      assert.equal(tags["XMP-dc:Rights"], "© 另一个作者 <作品集>");
    }
    assert.equal(await rebuildPhotoPreviews(id), false);
    await assertDisplayFilesOnly(id);
  } finally {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
  }
});

test("empty configuration removes old display attribution without enabling original downloads", async () => {
  try {
    delete process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR;
    delete process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE;
    const before = webpImageData(await readMedia(getMediaRecord(id, "preview")!));
    assert.equal(await rebuildPhotoPreviews(id), true);
    assert.deepEqual(webpImageData(await readMedia(getMediaRecord(id, "preview")!)), before);
    const tags = await readTags(id, "preview");
    assert.equal(tags["XMP-dc:Creator"], undefined);
    assert.equal(tags["XMP-dc:Rights"], undefined);
    const downloaded = await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), {
      params: Promise.resolve({ id, variant: "original" }),
    });
    assert.equal(downloaded.status, 404);
    assert.equal((await downloaded.arrayBuffer()).byteLength, 0);
  } finally {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
  }
});
