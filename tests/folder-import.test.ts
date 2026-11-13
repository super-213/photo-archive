import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs, { mkdtemp, mkdir, readFile, writeFile, symlink, readdir, realpath, lstat } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
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

test("nested files wait for copy stability, become credited drafts and remove only the imported source", async () => {
  await mkdir(path.join(inbox, "旅行"), { recursive: true });
  const filename = path.join(inbox, "旅行", "海边.JPG");
  await writeFile(filename, image.subarray(0, 100));
  await importer.scan();
  assert.equal(listPhotos(false).length, 0);
  assert.deepEqual(await readFile(filename), image.subarray(0, 100));
  now += 80;
  await writeFile(filename, image);
  await importer.scan();
  now += 80;
  await importer.scan();
  assert.equal(listPhotos(false).length, 0);
  assert.deepEqual(await readFile(filename), image);
  now += 25;
  await importer.scan();
  const photo = listPhotos(false)[0];
  assert.equal(photo.title, "海边");
  assert.equal(photo.visibility, "draft");
  assert.equal(photo.capturedAt, "2025-06-07");
  await assert.rejects(readFile(filename), { code: "ENOENT" });
  assert.ok((await lstat(path.dirname(filename))).isDirectory());
  assert.deepEqual(await readMedia(getMediaRecord(photo.id, "original")!), image);
  assert.equal(getMediaRecord(photo.id, "download"), undefined);
  for (const variant of ["thumbnail", "preview", "lightbox"]) assert.ok(getMediaRecord(photo.id, variant));
  assert.equal(getMediaRecord(photo.id, "grid"), undefined);
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
  await assert.rejects(readFile(path.join(inbox, "重复.jpg")), { code: "ENOENT" });
});

test("bad files report failure once, replacements retry, and hidden files and symlinks are ignored", async () => {
  const failed = path.join(inbox, "坏图.png");
  await writeFile(failed, "not an image");
  await writeFile(path.join(inbox, "notes.txt"), "ignore");
  await writeFile(path.join(inbox, ".hidden.jpg"), image);
  await symlink(path.join(inbox, ".hidden.jpg"), path.join(inbox, "linked.jpg"));
  await symlink(mediaDirectory, path.join(inbox, "linked-directory"));
  await importer.scan();
  now += 101;
  await importer.scan();
  assert.equal(getFolderImportStatus().counts.error, 1);
  assert.equal(await readFile(failed, "utf8"), "not an image");
  assert.equal(await readFile(path.join(inbox, "notes.txt"), "utf8"), "ignore");
  assert.deepEqual(await readFile(path.join(inbox, ".hidden.jpg")), image);
  assert.ok((await lstat(path.join(inbox, "linked.jpg"))).isSymbolicLink());
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
  await assert.rejects(readFile(failed), { code: "ENOENT" });
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
  assert.deepEqual(await readFile(filename), image);
  db.prepare("UPDATE folder_import SET owner_pid=2147483647 WHERE file_path=?").run(filename);
  await second.scan();
  assert.equal(getFolderImportStatus().counts.processing, 0);
  assert.equal(getFolderImportStatus().counts.duplicate, 3);
  await assert.rejects(readFile(filename), { code: "ENOENT" });
});

test("restart cleans up successful imports left before source deletion", async () => {
  const photo = listPhotos(false)[0];
  for (const status of ["imported", "duplicate"]) {
    const filename = path.join(inbox, `待清理-${status}.jpg`);
    await writeFile(filename, image);
    await importer.scan();
    db.prepare("UPDATE folder_import SET status=?,photo_id=? WHERE file_path=?").run(status, photo.id, filename);
    await createFolderImporter({ now: clock, settleMs: 100 }).scan();
    await assert.rejects(readFile(filename), { code: "ENOENT" });
    assert.equal(getFolderImportStatus().recent.find((entry) => entry.file === path.basename(filename))?.status, status);
    assert.deepEqual(await readMedia(getMediaRecord(photo.id, "original")!), image);
  }
});

test("a source replaced during media processing is retained and imported on a later scan", async (t) => {
  const filename = path.join(inbox, "处理中替换.jpg");
  const replacement = await sharp({ create: { width: 48, height: 32, channels: 3, background: "blue" } }).jpeg().toBuffer();
  await writeFile(filename, image);
  await importer.scan();
  now += 101;
  const copyFile = fs.copyFile;
  let replaced = false;
  const copy = t.mock.method(fs, "copyFile", async (...args: Parameters<typeof fs.copyFile>) => {
    await copyFile(...args);
    if (!replaced && String(args[0]).includes(`${path.sep}.folder-import-`)) {
      replaced = true;
      await writeFile(filename, replacement);
    }
  });
  syncBuiltinESMExports();
  try {
    await importer.scan();
  } finally {
    copy.mock.restore();
    syncBuiltinESMExports();
  }
  assert.ok(replaced);
  assert.deepEqual(await readFile(filename), replacement);
  await importer.scan();
  now += 101;
  await importer.scan();
  await assert.rejects(readFile(filename), { code: "ENOENT" });
  const entry = getFolderImportStatus().recent.find((item) => item.file === path.basename(filename))!;
  assert.equal(entry.status, "imported");
  assert.deepEqual(await readMedia(getMediaRecord(entry.photoId!, "original")!), replacement);
});

test("source deletion failures preserve the original, report an error and allow retry", async (t) => {
  const filename = path.join(inbox, "删除失败.jpg");
  await writeFile(filename, image);
  await importer.scan();
  now += 101;
  const unlink = fs.unlink;
  const deletion = t.mock.method(fs, "unlink", async (...args: Parameters<typeof fs.unlink>) => {
    if (String(args[0]) === filename) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    return unlink(...args);
  });
  syncBuiltinESMExports();
  try {
    await importer.scan();
  } finally {
    deletion.mock.restore();
    syncBuiltinESMExports();
  }
  const failure = getFolderImportStatus().recent.find((entry) => entry.file === path.basename(filename))!;
  assert.equal(failure.status, "error");
  assert.match(failure.error!, /照片已入库，但删除导入源文件失败/);
  assert.deepEqual(await readFile(filename), image);
  assert.deepEqual(await readMedia(getMediaRecord(failure.photoId!, "original")!), image);
  // Same reset as the manual --retry command, after waiting for stability.
  db.prepare("UPDATE folder_import SET status='waiting',observed_at=? WHERE file_path=?").run(now - 101, filename);
  await importer.scan();
  await assert.rejects(readFile(filename), { code: "ENOENT" });
  assert.equal(getFolderImportStatus().recent.find((entry) => entry.file === path.basename(filename))?.status, "duplicate");
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
