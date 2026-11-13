import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-copyright-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
const copyrightAuthor = "测试作者 & 工作室";
const copyrightNotice = "© 测试作者 & 工作室 保留所有权利";
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
const { importPhoto, getMediaRecord, readMedia, openCopyrightDownload, rebuildPhotoPreviews } =
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
  const record = getMediaRecord(id, variant === "download" ? "original" : variant)!;
  const filename = variant === "download" ? path.join(directory, "download-tags.jpg")
    : path.join(mediaDirectory, record.storage_key, record.filename);
  if (variant === "download") await writeFile(filename, await downloadBytes(id));
  try {
    const { stdout } = await run(exiftoolPath, [
      "-json", "-G1", "-s", "-Artist", "-Copyright", "-Creator", "-Rights",
      "-Make", "-Model", "-GPSLatitude", "-DateTimeOriginal",
      filename,
    ]);
    return JSON.parse(stdout)[0] as Record<string, unknown>;
  } finally {
    if (variant === "download") await rm(filename, { force: true });
  }
}

async function downloadBytes(id: string) {
  const download = await openCopyrightDownload(id);
  try { return await download.file.readFile(); }
  finally { await download.dispose(); }
}

async function assertNoTemporaryDownloads(id: string) {
  const record = getMediaRecord(id, "original")!;
  const directory = path.join(mediaDirectory, record.storage_key);
  // Stream cancellation/close releases its handle asynchronously.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!(await readdir(directory)).some((name) => name.startsWith(".copyright-"))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Temporary download was not removed");
}

function jpegImageData(bytes: Buffer) {
  let offset = 2;
  while (offset + 4 < bytes.length) {
    assert.equal(bytes[offset], 0xff);
    if (bytes[offset + 1] === 0xda) return bytes.subarray(offset);
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("JPEG scan data missing");
}

const pixels = Buffer.alloc(640 * 400 * 3);
for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 31 + Math.floor(index / 17)) % 256;
const jpeg = await sharp(pixels, { raw: { width: 640, height: 400, channels: 3 } })
  .withExif({
    IFD0: { Artist: "Camera author", Copyright: "Camera copyright", Make: "Camera brand", Model: "Camera model" },
    IFD2: { DateTimeOriginal: "2024:05:06 07:08:09" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "31/1 12/1 0/1" },
  }).jpeg({ quality: 95 }).toBuffer();
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

test("download copyright changes metadata and preserves JPEG compressed scan data, camera and GPS", async () => {
  const download = await downloadBytes(id);
  assert.deepEqual(jpegImageData(download), jpegImageData(jpeg));
  assert.deepEqual(await readMedia(getMediaRecord(id, "original")!), jpeg);
  assert.notEqual(createHash("sha256").update(download).digest("hex"), createHash("sha256").update(jpeg).digest("hex"));
  const tags = await readTags(id, "download");
  assert.equal(tags["IFD0:Artist"], copyrightAuthor);
  assert.equal(tags["IFD0:Copyright"], copyrightNotice);
  assert.equal(tags["XMP-dc:Creator"], copyrightAuthor);
  assert.equal(tags["XMP-dc:Rights"], copyrightNotice);
  assert.equal(tags["IFD0:Model"], "Camera model");
  assert.ok(tags["GPS:GPSLatitude"]);
  assert.equal(tags["ExifIFD:DateTimeOriginal"], "2024:05:06 07:08:09");
  const reimported = await importPhoto(download, "already-credited.jpg");
  assert.equal(getMediaRecord(reimported.photo.id, "download"), undefined);
  assert.equal((await readTags(reimported.photo.id, "download"))["XMP-dc:Rights"], copyrightNotice);
});

test("downloads are temporary, independent for concurrent requests and require visibility", async () => {
  const original = getMediaRecord(id, "original")!;
  const photoDirectory = path.join(mediaDirectory, original.storage_key);
  const context = { params: Promise.resolve({ id, variant: "original" }) };
  assert.equal((await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), context)).status, 404);
  assert.equal(getMediaRecord(id, "download"), undefined);
  const downloads = await Promise.all([openCopyrightDownload(id), openCopyrightDownload(id), openCopyrightDownload(id)]);
  try {
    await downloads[0].dispose();
    assert.deepEqual(await downloads[1].file.readFile(), await downloads[2].file.readFile());
  } finally { await Promise.all(downloads.map((download) => download.dispose())); }
  assert.deepEqual((await readdir(photoDirectory)).sort(), ["lightbox.webp", "original.jpg", "preview.webp", "thumbnail.webp"]);
  const photo = getPhoto(id)!;
  updatePhoto(id, photoInput.parse({ ...photo, visibility: "public" }));
  const response = await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), context);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(jpegImageData(bytes), jpegImageData(jpeg));
  await assertNoTemporaryDownloads(id);
  const internal = await mediaRoute.GET(new Request(`http://localhost/media/${id}/download`), {
    params: Promise.resolve({ id, variant: "download" }),
  });
  assert.equal(internal.status, 404);
  assert.equal(await rebuildPhotoPreviews(id), false);
});

test("HEAD, invalid ranges, cancellation and aborted downloads clean up temporary files", async () => {
  const url = `http://localhost/media/${id}/original`;
  const context = { params: Promise.resolve({ id, variant: "original" }) };
  const head = await mediaRoute.HEAD(new Request(url, { method: "HEAD" }), context);
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.ok(Number(head.headers.get("content-length")) > 0);
  await assertNoTemporaryDownloads(id);
  const invalid = await mediaRoute.GET(new Request(url, { headers: { range: "bytes=999999999-" } }), context);
  assert.equal(invalid.status, 416);
  await assertNoTemporaryDownloads(id);
  const canceled = await mediaRoute.GET(new Request(url), context);
  assert.equal(canceled.status, 200);
  await canceled.body!.cancel();
  await assertNoTemporaryDownloads(id);
  const controller = new AbortController();
  const aborted = await mediaRoute.GET(new Request(url, { signal: controller.signal }), context);
  controller.abort();
  await aborted.body!.cancel();
  await assertNoTemporaryDownloads(id);
});

test("rebuilding retires legacy download copies and records without changing originals", async () => {
  const original = getMediaRecord(id, "original")!;
  const filename = path.join(mediaDirectory, original.storage_key, "download.jpg");
  const preview = await readMedia(getMediaRecord(id, "preview")!);
  await writeFile(filename, await downloadBytes(id));
  getDatabase().prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'download','download.jpg','image/jpeg')").run(id);
  assert.equal(await rebuildPhotoPreviews(id), true);
  assert.equal(await rebuildPhotoPreviews(id), false);
  assert.equal(getMediaRecord(id, "download"), undefined);
  assert.ok(!(await readdir(path.dirname(filename))).includes("download.jpg"));
  assert.deepEqual(await readMedia(original), jpeg);
  assert.deepEqual(await readMedia(getMediaRecord(id, "preview")!), preview);
});

test("third-party sample photos retain their source attribution", async () => {
  const source = await sharp(jpeg).resize(320).withExif({ IFD0: { Artist: "Sample author", Copyright: "Sample copyright" } }).jpeg().toBuffer();
  const sample = (await importPhoto(source, "sample.jpg", { isSample: true })).photo;
  assert.equal(getMediaRecord(sample.id, "download"), undefined);
  assert.deepEqual(await downloadBytes(sample.id), source);
  const tags = await readTags(sample.id, "preview");
  assert.notEqual(tags["XMP-dc:Rights"], copyrightNotice);
  assert.equal((await readTags(sample.id, "original"))["IFD0:Copyright"], "Sample copyright");
});

test("changing copyright configuration refreshes cached media automatically", async () => {
  const previousPreview = getMediaRecord(id, "preview")!;
  try {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "另一个作者";
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "© 另一个作者 <作品集>";
    assert.equal(await rebuildPhotoPreviews(id), true);
    assert.equal(getMediaRecord(id, "download"), undefined);
    assert.notEqual(getMediaRecord(id, "preview")!.encoding_version, previousPreview.encoding_version);
    for (const variant of ["preview", "download"]) {
      const tags = await readTags(id, variant);
      assert.equal(tags["XMP-dc:Creator"], "另一个作者");
      assert.equal(tags["XMP-dc:Rights"], "© 另一个作者 <作品集>");
    }
    assert.equal(await rebuildPhotoPreviews(id), false);
    assert.deepEqual(await readMedia(getMediaRecord(id, "original")!), jpeg);
  } finally {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
  }
});

test("empty configuration uses uploaded originals and removes old display attribution on rebuild", async () => {
  try {
    delete process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR;
    delete process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE;
    assert.deepEqual(await downloadBytes(id), jpeg);
    assert.equal(await rebuildPhotoPreviews(id), true);
    const tags = await readTags(id, "preview");
    assert.equal(tags["XMP-dc:Creator"], undefined);
    assert.equal(tags["XMP-dc:Rights"], undefined);
    const downloaded = await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), {
      params: Promise.resolve({ id, variant: "original" }),
    });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), jpeg);
  } finally {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
  }
});
