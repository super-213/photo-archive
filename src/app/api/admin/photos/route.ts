import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { apiAction, json, requireAdministrator } from "@/lib/server/http";
import { listPhotos } from "@/lib/server/store";
import { mediaDirectory, getDatabase } from "@/lib/server/database";
import { receivePhotoUpload } from "@/lib/server/upload";
import { importPhotoFile } from "@/lib/server/media";
import { AppError } from "@/lib/server/validation";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    return json(listPhotos(false));
  });
}
let activeUploads = 0;
const maxConcurrentUploads = 2;

export async function POST(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    if (activeUploads >= maxConcurrentUploads)
      throw new AppError("正在处理其他照片，请稍后重试", 429);
    activeUploads++;
    let temporary: string | undefined;
    try {
      getDatabase();
      temporary = await mkdtemp(path.join(mediaDirectory, ".upload-"));
      const { source, filename } = await receivePhotoUpload(request, temporary);
      return json(await importPhotoFile(source, filename), 201);
    } finally {
      activeUploads--;
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  });
}
