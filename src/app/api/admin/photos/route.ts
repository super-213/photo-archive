import { apiAction, json, requireAdministrator } from "@/lib/server/http";
import { listPhotos } from "@/lib/server/store";
import { importPhoto, maxUploadBytes } from "@/lib/server/media";
import { AppError } from "@/lib/server/validation";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    return json(listPhotos(false));
  });
}
export async function POST(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    const limit = maxUploadBytes + 1024 * 1024;
    if (Number(request.headers.get("content-length")) > limit)
      throw new AppError("单次上传大小超过限制", 413);
    if (!request.body) throw new AppError("请选择照片");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new AppError("单次上传大小超过限制", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: Buffer.concat(chunks),
      }).formData();
    } catch {
      throw new AppError("上传表单格式无效");
    }
    const files = form.getAll("file");
    if (files.length !== 1 || !(files[0] instanceof File))
      throw new AppError("每个上传请求需要包含一张照片");
    const file = files[0];
    return json(
      await importPhoto(Buffer.from(await file.arrayBuffer()), file.name),
      201,
    );
  });
}
