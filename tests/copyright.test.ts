import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-copyright-test-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
const copyrightAuthor = "测试作者 & 工作室";
const copyrightNotice = "© 测试作者 & 工作室 保留所有权利";
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = copyrightAuthor;
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = copyrightNotice;
const { importPhoto, getMediaRecord, readMedia, ensureCopyrightDownload, rebuildPhotoPreviews } =
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
    const actual = await sharp(await readMedia(getMediaRecord(id, variant.name)!)).raw().toBuffer();
    const expected = await sharp(jpeg).rotate().resize({
      width: variant.width, height: variant.width, fit: "inside", withoutEnlargement: true,
    }).raw().toBuffer();
    assert.deepEqual(actual, expected);
  }
});

test("download copyright changes metadata and preserves JPEG compressed scan data, camera and GPS", async () => {
  const download = await readMedia(getMediaRecord(id, "download")!);
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
  assert.ok(getMediaRecord(reimported.photo.id, "download"));
  assert.equal((await readTags(reimported.photo.id, "download"))["XMP-dc:Rights"], copyrightNotice);
});

test("missing legacy download files are generated once and visibility is checked before download", async () => {
  const previous = getMediaRecord(id, "download")!;
  getDatabase().prepare("DELETE FROM media_variant WHERE photo_id=? AND variant='download'").run(id);
  await rm(path.join(mediaDirectory, previous.storage_key, previous.filename));
  const context = { params: Promise.resolve({ id, variant: "original" }) };
  assert.equal((await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), context)).status, 404);
  assert.equal(getMediaRecord(id, "download"), undefined);
  const records = await Promise.all([ensureCopyrightDownload(id), ensureCopyrightDownload(id), ensureCopyrightDownload(id)]);
  assert.ok(records.every((record) => record?.filename === previous.filename));
  const photo = getPhoto(id)!;
  updatePhoto(id, photoInput.parse({ ...photo, visibility: "public" }));
  const response = await mediaRoute.GET(new Request(`http://localhost/media/${id}/original`), context);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readMedia(getMediaRecord(id, "download")!));
  const internal = await mediaRoute.GET(new Request(`http://localhost/media/${id}/download`), {
    params: Promise.resolve({ id, variant: "download" }),
  });
  assert.equal(internal.status, 404);
  assert.equal(await rebuildPhotoPreviews(id), false);
});

test("third-party sample photos retain their source attribution", async () => {
  const source = await sharp(jpeg).resize(320).withExif({ IFD0: { Artist: "Sample author", Copyright: "Sample copyright" } }).jpeg().toBuffer();
  const sample = (await importPhoto(source, "sample.jpg", { isSample: true })).photo;
  assert.equal(getMediaRecord(sample.id, "download"), undefined);
  assert.deepEqual(await readMedia((await ensureCopyrightDownload(sample.id))!), source);
  const tags = await readTags(sample.id, "grid");
  assert.notEqual(tags["XMP-dc:Rights"], copyrightNotice);
  assert.equal((await readTags(sample.id, "original"))["IFD0:Copyright"], "Sample copyright");
});

test("changing copyright configuration refreshes cached media automatically", async () => {
  const previousDownload = getMediaRecord(id, "download")!;
  const previousPreview = getMediaRecord(id, "grid")!;
  try {
    process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "另一个作者";
    process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "© 另一个作者 <作品集>";
    assert.equal(await rebuildPhotoPreviews(id), true);
    assert.notEqual(getMediaRecord(id, "download")!.encoding_version, previousDownload.encoding_version);
    assert.notEqual(getMediaRecord(id, "grid")!.encoding_version, previousPreview.encoding_version);
    for (const variant of ["grid", "download"]) {
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
    const record = await ensureCopyrightDownload(id);
    assert.equal(record?.filename, getMediaRecord(id, "original")!.filename);
    assert.equal(await rebuildPhotoPreviews(id), true);
    const tags = await readTags(id, "grid");
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
