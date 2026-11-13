import "server-only";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, getDatabase } from "./database";
import { importPhotoFile } from "./media";
import { maxUploadBytes } from "../media-settings";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".heif", ".heic", ".tif", ".tiff"]);
const pollInterval = 3_000;
const settleTime = 6_000;
type ImportRow = {
  file_path: string;
  signature: string;
  observed_at: number;
  updated_at: number;
  status: "waiting" | "processing" | "imported" | "duplicate" | "error";
  owner_pid: number | null;
  photo_id: string | null;
  error: string;
};

export function getImportDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.PHOTO_ARCHIVE_IMPORT_DIR || "imports");
}

function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function prepareDirectory(directory: string) {
  const data = await realpath(dataDirectory);
  const publicDirectory = await realpath(path.resolve("public")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return path.resolve("public");
    throw error;
  });
  if (contains(data, directory) || contains(directory, data) || contains(publicDirectory, directory) || contains(directory, publicDirectory))
    throw new Error("照片导入目录不能与数据目录或 public 静态目录重叠");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  if (contains(data, root) || contains(root, data) || contains(publicDirectory, root) || contains(root, publicDirectory))
    throw new Error("照片导入目录不能与数据目录或 public 静态目录重叠");
  return root;
}

async function* findImages(directory: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    console.error(`[文件夹导入] 无法读取文件夹 ${directory}`, error);
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* findImages(filename);
    else if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) yield filename;
  }
}

async function signature(filename: string) {
  const info = await lstat(filename);
  if (!info.isFile()) throw new Error("仅导入普通照片文件");
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

async function removeImportedSource(filename: string, expectedSignature: string) {
  try {
    // Importing can take time. Leave a replaced or modified source for the next scan.
    if (await signature(filename) !== expectedSignature) return;
    await unlink(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`照片已入库，但删除导入源文件失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function processExists(pid: number | null) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

export function getFolderImportStatus(directory = getImportDirectory()) {
  try { directory = realpathSync(directory); } catch { /* The first scan creates the directory. */ }
  const rows = getDatabase().prepare("SELECT * FROM folder_import ORDER BY updated_at DESC").all() as ImportRow[];
  const entries = rows.filter((row) => contains(directory, row.file_path));
  return {
    directory,
    enabled: process.env.PHOTO_ARCHIVE_FOLDER_IMPORT !== "false",
    counts: {
      waiting: entries.filter((row) => row.status === "waiting").length,
      processing: entries.filter((row) => row.status === "processing").length,
      imported: entries.filter((row) => row.status === "imported").length,
      duplicate: entries.filter((row) => row.status === "duplicate").length,
      error: entries.filter((row) => row.status === "error").length,
    },
    errors: entries.filter((row) => row.status === "error").slice(0, 20).map((row) => ({
      file: path.relative(directory, row.file_path), error: row.error,
    })),
    recent: entries.slice(0, 100).map((row) => ({
      file: path.relative(directory, row.file_path), status: row.status,
      photoId: row.photo_id, error: row.error || undefined,
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
  };
}

export function createFolderImporter(options: { directory?: string; settleMs?: number; now?: () => number } = {}) {
  const directory = path.resolve(/* turbopackIgnore: true */ options.directory || getImportDirectory());
  const now = options.now || Date.now;
  const settleMs = options.settleMs ?? settleTime;
  let running = false;

  async function scan() {
    if (running) return;
    running = true;
    let dirty = false;
    try {
      const db = getDatabase();
      const root = await prepareDirectory(directory);
      for await (const filename of findImages(root)) {
        let currentSignature: string;
        try { currentSignature = await signature(filename); }
        catch { continue; } // A file can disappear while being copied or renamed.
        const timestamp = now();
        const claim = db.transaction(() => {
          const previous = db.prepare("SELECT * FROM folder_import WHERE file_path=?").get(filename) as ImportRow | undefined;
          if (!previous || previous.signature !== currentSignature) {
            if (previous?.status === "processing" && processExists(previous.owner_pid)) return false;
            db.prepare(`INSERT INTO folder_import(file_path,signature,observed_at,updated_at,status)
              VALUES (?,?,?,?,'waiting') ON CONFLICT(file_path) DO UPDATE SET
              signature=excluded.signature,observed_at=excluded.observed_at,updated_at=excluded.updated_at,
              status='waiting',owner_pid=NULL,photo_id=NULL,error=''`)
              .run(filename, currentSignature, timestamp, timestamp);
            dirty = true;
            return false;
          }
          if (previous.status === "processing" && processExists(previous.owner_pid)) return false;
          // Finish cleanup after a restart, including files imported by older versions.
          if ((previous.status === "imported" || previous.status === "duplicate") && previous.photo_id)
            return "cleanup";
          if (previous.status !== "waiting" && previous.status !== "processing") return false;
          if (timestamp - previous.observed_at < settleMs) return false;
          db.prepare("UPDATE folder_import SET status='processing',owner_pid=?,updated_at=? WHERE file_path=?")
            .run(process.pid, timestamp, filename);
          return "import";
        }).immediate();
        if (!claim) continue;
        dirty = true;
        let temporary: string | undefined;
        try {
          if (claim === "import") {
            const info = await lstat(filename);
            if (!info.isFile()) throw new Error("仅导入普通照片文件");
            if (!info.size || info.size > maxUploadBytes) throw new Error("单张照片大小应在 1 字节至 256 MiB 之间");
            // Work from a stable snapshot; a source changing during the copy waits for another scan.
            temporary = await mkdtemp(path.join(dataDirectory, ".folder-import-"));
            const snapshot = path.join(temporary, "source");
            await copyFile(filename, snapshot);
            if (await signature(filename) !== currentSignature) {
              db.prepare("DELETE FROM folder_import WHERE file_path=? AND owner_pid=?").run(filename, process.pid);
              continue;
            }
            const result = await importPhotoFile(snapshot, path.basename(filename), { visibility: "draft" });
            const status = result.duplicate ? "duplicate" : "imported";
            db.prepare("UPDATE folder_import SET status=?,photo_id=?,owner_pid=NULL,updated_at=?,error='' WHERE file_path=?")
              .run(status, result.photo.id, now(), filename);
            console.log(`[文件夹导入] ${status === "duplicate" ? "已存在" : "已导入草稿"}：${path.relative(root, filename)}`);
          }
          // Only remove the source after both media storage and the import record succeed.
          await removeImportedSource(filename, currentSignature);
        } catch (error) {
          const message = error instanceof Error ? error.message : "导入失败";
          db.prepare("UPDATE folder_import SET status='error',owner_pid=NULL,updated_at=?,error=? WHERE file_path=?")
            .run(now(), message, filename);
          console.error(`[文件夹导入] ${path.relative(root, filename)}：${message}`);
        } finally {
          if (temporary) await rm(temporary, { recursive: true, force: true });
        }
      }
      if (dirty) {
        const report = path.join(root, "导入记录.json");
        const temporaryReport = `${report}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporaryReport, JSON.stringify(getFolderImportStatus(root), null, 2), { mode: 0o600 });
          await rename(temporaryReport, report);
        } finally {
          await rm(temporaryReport, { force: true });
        }
      }
    } finally {
      running = false;
    }
  }

  return { scan, directory };
}

const watcherKey = Symbol.for("photo-archive.folder-importer");
export function startFolderImporter() {
  if (process.env.PHOTO_ARCHIVE_FOLDER_IMPORT === "false") return;
  const globals = globalThis as typeof globalThis & { [watcherKey]?: boolean };
  if (globals[watcherKey]) return;
  globals[watcherKey] = true;
  const importer = createFolderImporter();
  console.log(`[文件夹导入] 监听 ${importer.directory}`);
  async function tick() {
    try { await importer.scan(); }
    catch (error) { console.error("[文件夹导入] 扫描失败", error); }
    setTimeout(tick, pollInterval).unref();
  }
  // Start after the server is ready; importing a batch must not delay startup.
  setTimeout(tick, pollInterval).unref();
}
