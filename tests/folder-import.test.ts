import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, realpath } from "node:fs/promises";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "photo-folder-import-test-")));
process.env.PHOTO_ARCHIVE_DATA_DIR = path.join(directory, "data");
process.env.PHOTO_ARCHIVE_IMPORT_DIR = path.join(directory, "inbox");
process.env.PHOTO_ARCHIVE_COPYRIGHT_AUTHOR = "导入测试作者";
process.env.PHOTO_ARCHIVE_COPYRIGHT_NOTICE = "© 导入测试";
const { createFolderImporter, getFolderImportStatus } = await import("../src/lib/server/folder-import");
const { getDatabase, mediaDirectory } = await import("../src/lib/server/database");
const { getPhoto, listPhotos, updatePhoto } = await import("../src/lib/server/store");
const { getMediaRecord, readMedia } = await import("../src/lib/server/media");
const { photoInput } = await import("../src/lib/server/validation");
const importStatusRoute = await import("../src/app/api/admin/imports/route");
const db = getDatabase();
const inbox = process.env.PHOTO_ARCHIVE_IMPORT_DIR!;
let now = 100_000;
const clock = () => now;
const importer = createFolderImporter({ now: clock, settleMs: 100 });
const image = await sharp({ create: { width: 48, height: 32, channels: 3, background: "red" } })
  .withExif({ IFD0: { Make: "测试相机" }, IFD2: { DateTimeOriginal: "2025:06:07 08:09:10" } }).jpeg().toBuffer();

after(async () => {
  db.close();
  await rm(directory, { recursive: true, force: true });
});

test("nested files wait for copy stability, become credited drafts and preserve source bytes", async () => {
  await mkdir(path.join(inbox, "旅行"), { recursive: true });
  const filename = path.join(inbox, "旅行", "海边.JPG");
  await writeFile(filename, image.subarray(0, 100));
  await importer.scan();
  assert.equal(listPhotos(false).length, 0);
  now += 80;
  await writeFile(filename, image);
  await importer.scan();
  now += 80;
  await importer.scan();
  assert.equal(listPhotos(false).length, 0);
  now += 25;
  await importer.scan();
  const photo = listPhotos(false)[0];
  assert.equal(photo.title, "海边");
  assert.equal(photo.visibility, "draft");
  assert.equal(photo.capturedAt, "2025-06-07");
  assert.deepEqual(await readFile(filename), image);
  assert.deepEqual(await readMedia(getMediaRecord(photo.id, "original")!), image);
  assert.ok(getMediaRecord(photo.id, "download"));
  for (const variant of ["thumbnail", "preview", "grid", "lightbox"]) assert.ok(getMediaRecord(photo.id, variant));
  const report = JSON.parse(await readFile(path.join(inbox, "导入记录.json"), "utf8"));
  assert.equal(report.counts.imported, 1);
  assert.equal(report.recent[0].file, path.join("旅行", "海边.JPG"));
});

test("restart and duplicate paths do not overwrite edited metadata or published visibility", async () => {
  const photo = listPhotos(false)[0];
  updatePhoto(photo.id, photoInput.parse({ ...photo, title: "手动标题", visibility: "public", tags: ["旅行"] }));
  const restart = createFolderImporter({ now: clock, settleMs: 100 });
  const before = getFolderImportStatus().recent[0].updatedAt;
  await restart.scan();
  assert.equal(getFolderImportStatus().recent[0].updatedAt, before);
  await writeFile(path.join(inbox, "重复.jpg"), image);
  await restart.scan();
  now += 101;
  await restart.scan();
  assert.equal(listPhotos(false).length, 1);
  assert.equal(getFolderImportStatus().counts.duplicate, 1);
  assert.equal(getPhoto(photo.id)?.title, "手动标题");
  assert.equal(getPhoto(photo.id)?.visibility, "public");
  assert.deepEqual(getPhoto(photo.id)?.tags, ["旅行"]);
});

test("bad files report failure once, replacements retry, and hidden files and symlinks are ignored", async () => {
  const failed = path.join(inbox, "坏图.png");
  await writeFile(failed, "not an image");
  await writeFile(path.join(inbox, "notes.txt"), "ignore");
  await writeFile(path.join(inbox, ".hidden.jpg"), image);
  await symlink(path.join(inbox, "重复.jpg"), path.join(inbox, "linked.jpg"));
  await symlink(mediaDirectory, path.join(inbox, "linked-directory"));
  await importer.scan();
  now += 101;
  await importer.scan();
  assert.equal(getFolderImportStatus().counts.error, 1);
  const failure = getFolderImportStatus().recent.find((item) => item.file === "坏图.png")!;
  assert.match(failure.error!, /无法读取图片/);
  now += 200;
  await importer.scan();
  assert.equal(getFolderImportStatus().recent.find((item) => item.file === "坏图.png")!.updatedAt, failure.updatedAt);
  await writeFile(failed, image);
  await importer.scan();
  now += 101;
  await importer.scan();
  assert.equal(getFolderImportStatus().counts.error, 0);
  assert.equal(getFolderImportStatus().counts.duplicate, 2);
  assert.equal(getFolderImportStatus().recent.length, 3);
  assert.deepEqual((await readdir(process.env.PHOTO_ARCHIVE_DATA_DIR!)).filter((name) => name.startsWith(".folder-import-")), []);
});

test("separate scanners avoid an active claim and recover work left by an exited process", async () => {
  const filename = path.join(inbox, "中断.jpg");
  await writeFile(filename, image);
  await importer.scan();
  now += 101;
  db.prepare("UPDATE folder_import SET status='processing',owner_pid=? WHERE file_path=?").run(process.pid, filename);
  const second = createFolderImporter({ now: clock, settleMs: 100 });
  await second.scan();
  assert.equal(getFolderImportStatus().counts.processing, 1);
  db.prepare("UPDATE folder_import SET owner_pid=2147483647 WHERE file_path=?").run(filename);
  await second.scan();
  assert.equal(getFolderImportStatus().counts.processing, 0);
  assert.equal(getFolderImportStatus().counts.duplicate, 3);
});

test("data and static directories cannot be used as import folders, including symlink aliases", async () => {
  for (const forbidden of [process.env.PHOTO_ARCHIVE_DATA_DIR!, path.resolve("public")]) {
    await assert.rejects(createFolderImporter({ directory: forbidden }).scan(), /不能.*重叠/);
  }
  const alias = path.join(directory, "data-alias");
  await symlink(process.env.PHOTO_ARCHIVE_DATA_DIR!, alias);
  await assert.rejects(createFolderImporter({ directory: alias }).scan(), /不能.*重叠/);
  assert.equal((await importStatusRoute.GET(new Request("http://localhost/api/admin/imports"))).status, 401);
});
