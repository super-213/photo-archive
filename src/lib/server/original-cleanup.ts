import "server-only";
import { getDatabase } from "./database";
import { rebuildPhotoPreviews } from "./media";
import { originalDownloadsEnabled } from "./media-policy";

export async function cleanupDisabledOriginals() {
  const result = { cleaned: 0, failed: 0 };
  if (originalDownloadsEnabled()) return result;
  const photos = getDatabase().prepare(
    "SELECT DISTINCT photo_id FROM media_variant WHERE variant IN ('original','download')",
  ).all() as { photo_id: string }[];
  for (const { photo_id: id } of photos) {
    if (originalDownloadsEnabled()) break;
    try {
      // Rebuilding verifies all three displays before removing originals and download copies.
      if (await rebuildPhotoPreviews(id)) result.cleaned++;
    } catch (error) {
      result.failed++;
      console.error(`[原图清理] ${id}：清理失败，稍后重试`, error);
    }
  }
  if (result.cleaned) console.log(`[原图清理] 已清理 ${result.cleaned} 张照片的历史原图或下载副本`);
  return result;
}

const workerKey = Symbol.for("photo-archive.original-cleanup");
export function startOriginalCleanupWorker() {
  if (originalDownloadsEnabled()) return;
  const globals = globalThis as typeof globalThis & { [workerKey]?: boolean };
  if (globals[workerKey]) return;
  globals[workerKey] = true;
  async function tick() {
    try { await cleanupDisabledOriginals(); }
    catch (error) { console.error("[原图清理] 扫描失败，稍后重试", error); }
    setTimeout(tick, 30_000).unref();
  }
  setTimeout(tick, 1_000).unref();
}
