import "server-only";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { maxUploadBytes } from "../media-settings";
import { AppError } from "./validation";

export async function receivePhotoUpload(request: Request, directory: string) {
  const limit = maxUploadBytes + 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError("单次上传大小超过限制", 413);
  if (!request.body) throw new AppError("请选择照片");
  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: Object.fromEntries(request.headers),
      defParamCharset: "utf8",
      limits: { files: 1, fieldSize: 16 * 1024, fileSize: maxUploadBytes + 1 },
    });
  } catch {
    throw new AppError("上传表单格式无效");
  }
  let filename: string | undefined;
  let writing = Promise.resolve();
  let writeError: Error | undefined;
  const source = path.join(directory, "source");
  const fail = (error: Error) => queueMicrotask(() => parser.destroy(error));
  const rejectParts = () => fail(new AppError("每个上传请求需要包含一张照片"));
  parser.on("filesLimit", rejectParts);
  parser.on("file", (name, file, info) => {
    if (name !== "file") {
      file.on("error", (error: Error) => { writeError = error; });
      file.resume();
      rejectParts();
      return;
    }
    filename = info.filename || "未命名照片";
    file.on("limit", () => fail(new AppError("单张照片最大 256 MiB", 413)));
    writing = pipeline(file, createWriteStream(source, { flags: "wx", mode: 0o600 }), {
      signal: request.signal,
    }).catch((error: Error) => {
      writeError = error;
      parser.destroy(error);
    });
  });
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new AppError("单次上传大小超过限制", 413) : null, chunk);
    },
  });
  try {
    const input = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(input, counter, parser, { signal: request.signal });
    await writing;
    if (writeError) throw writeError;
    if (!filename) throw new AppError("请选择照片");
    return { source, filename };
  } catch (error) {
    await writing;
    if (error instanceof AppError) throw error;
    throw new AppError("上传中断或表单格式无效，请重试");
  }
}
