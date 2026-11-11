import { readFile } from "node:fs/promises";
import { samplePhotos, sampleProjects } from "../src/lib/seed-content";
import { importPhoto } from "../src/lib/server/media";
import { getPhoto, listProjects, saveProject } from "../src/lib/server/store";
import { getAuth } from "../src/lib/server/auth";
import { projectInput } from "../src/lib/server/validation";
import type { Category } from "../src/lib/content";

async function main() {
  await getAuth();
  const ids = new Map<string, string>();
  for (const photo of samplePhotos) {
    const existing = getPhoto(photo.id);
    if (existing) {
      ids.set(photo.id, existing.id);
      continue;
    }
    const result = await importPhoto(
      await readFile(`samples/photos/${photo.id}.jpg`),
      `${photo.id}.jpg`,
      {
        ...photo,
        category: photo.category as Category,
        visibility: "public",
        isSample: true,
      },
    );
    ids.set(photo.id, result.photo.id);
  }
  for (const [index, project] of sampleProjects.entries()) {
    if (listProjects(false).some((existing) => existing.slug === project.slug))
      continue;
    const items = project.layouts.flatMap((layout) =>
      layout.photoIds.map((id) => ({
        photoId: ids.get(id)!,
        layoutType: layout.type,
        caption: "",
      })),
    );
    const canPublish = items.every(
      (item) => getPhoto(item.photoId)?.visibility === "public",
    );
    saveProject(
      null,
      projectInput.parse({
        ...project,
        coverPhotoId: ids.get(project.coverPhotoId),
        version: 0,
        sortOrder: index,
        status: canPublish ? "published" : "draft",
        items,
      }),
    );
  }
  console.log(
    "数据库已初始化，样例照片和系列已导入。已有内容保持现有编辑结果。",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
