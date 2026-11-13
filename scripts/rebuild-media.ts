import "./environment.mjs";
import { getDatabase } from "../src/lib/server/database";
import { rebuildPhotoPreviews } from "../src/lib/server/media";
import { flushPreviewCachePurges } from "../src/lib/server/cdn-cache";

async function main() {
  const photos = getDatabase().prepare("SELECT id FROM photo ORDER BY uploaded_at, id").all() as { id: string }[];
  let updated = 0;
  for (const [index, photo] of photos.entries()) {
    if (await rebuildPhotoPreviews(photo.id)) updated++;
    console.log(`展示图检查 ${index + 1}/${photos.length}，已更新 ${updated} 张`);
  }
  console.log(`展示图处理完成，共更新 ${updated} 张照片。`);
  await flushPreviewCachePurges();
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "展示图处理失败");
  process.exitCode = 1;
});
