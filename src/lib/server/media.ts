import "server-only";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import exifr from "exifr";
import { mediaDirectory, getDatabase } from "./database";
import { getPhoto } from "./store";
import { AppError, captureDate } from "./validation";
import type { Category, Photo } from "../content";

import { createCopyrightXmp, getCopyrightSettings, writeCopyrightDownload, type CopyrightSettings } from "./copyright";
import { maxUploadBytes, maxInputPixels, previewEncodingVersion, previewVariants } from "../media-settings";
import { queuePreviewCachePurge } from "./cdn-cache";
export { maxUploadBytes } from "../media-settings";
const formats: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
  heif: "heif",
  tiff: "tiff",
};
type ImportOptions = {
  id?: string;
  title?: string;
  alt?: string;
  category?: Category;
  year?: string;
  location?: string;
  source?: string;
  isSample?: boolean;
  visibility?: Photo["visibility"];
};

export async function importPhoto(buffer: Buffer, filename: string, options: ImportOptions = {}) {
  if (!buffer.length || buffer.length > maxUploadBytes)
    throw new AppError("单张照片大小应在 1 字节至 256 MiB 之间", 413);
  getDatabase();
  const temporary = await mkdtemp(path.join(mediaDirectory, ".upload-"));
  try {
    const source = path.join(temporary, "source");
    await writeFile(source, buffer, { mode: 0o600 });
    return await importPhotoFile(source, filename, options);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function generatePreviews(source: string, directory: string, copyright: CopyrightSettings | undefined) {
  for (const variant of previewVariants) {
    const image = sharp(source, { limitInputPixels: maxInputPixels })
      .rotate()
      .resize({ width: variant.width, height: variant.width, fit: "inside", withoutEnlargement: true })
      .keepIccProfile();
    if (copyright) image.withXmp(createCopyrightXmp(copyright));
    await image.webp({ lossless: true, exact: true, effort: 4 })
      .toFile(path.join(directory, `${variant.name}.webp`));
  }
}

export async function importPhotoFile(source: string, filename: string, options: ImportOptions = {}) {
  const size = (await stat(source)).size;
  if (!size || size > maxUploadBytes)
    throw new AppError("单张照片大小应在 1 字节至 256 MiB 之间", 413);
  const db = getDatabase();
  const id = options.id || randomUUID();
  const storageKey = randomUUID();
  const staging = await mkdtemp(path.join(mediaDirectory, ".upload-"));
  const destination = path.join(mediaDirectory, storageKey);
  let committed = false;
  try {
    let originalFile = path.join(staging, "source");
    await copyFile(source, originalFile);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(originalFile)) hash.update(chunk);
    const digest = hash.digest("hex");
    const existing = db.prepare("SELECT id FROM photo WHERE digest=?").get(digest) as { id: string } | undefined;
    if (existing) {
      await rebuildPhotoPreviews(existing.id);
      return { photo: getPhoto(existing.id)!, duplicate: true };
    }
    let metadata: Metadata;
    try {
      metadata = await sharp(originalFile, { limitInputPixels: maxInputPixels }).metadata();
    } catch {
      throw new AppError("无法读取图片，请上传有效的 JPEG、PNG、WebP、AVIF 或 TIFF 照片，最大支持 2.4 亿像素");
    }
    if (!metadata.format || !formats[metadata.format] || !metadata.width || !metadata.height || (metadata.pages || 1) > 1)
      throw new AppError("请选择单帧 JPEG、PNG、WebP、AVIF 或 TIFF 照片");
    const format = metadata.format === "heif" && metadata.compression === "av1" ? "avif" : metadata.format;
    const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    const originalName = `original.${formats[format]}`;
    await rename(originalFile, path.join(staging, originalName));
    originalFile = path.join(staging, originalName);
    const copyright = options.isSample ? undefined : getCopyrightSettings();
    const encodingVersion = copyright?.previewVersion ?? previewEncodingVersion;
    await generatePreviews(originalFile, staging, copyright);
    const downloadName = `download.${formats[format]}`;
    if (copyright) await writeCopyrightDownload(originalFile, path.join(staging, downloadName), mimeType, copyright);
    const exif = await exifr
      .parse(originalFile, {
        gps: false,
        reviveValues: false,
        pick: [
          "DateTimeOriginal",
          "Make",
          "Model",
          "LensModel",
          "FocalLength",
          "FNumber",
          "ExposureTime",
          "ISO",
        ],
      })
      .catch(() => null);
    const dateMatch = String(exif?.DateTimeOriginal || "").match(
      /^(\d{4})[:-](\d{2})[:-](\d{2})/,
    );
    const parsedDate = captureDate.safeParse(
      dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "",
    );
    const capturedAt = parsedDate.success ? parsedDate.data : "";
    const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
    const exposure = Number(exif?.ExposureTime);
    await rename(staging, destination);
    const result = db
      .transaction(() => {
        const duplicate = db
          .prepare("SELECT id FROM photo WHERE digest=?")
          .get(digest) as { id: string } | undefined;
        if (duplicate)
          return { photo: getPhoto(duplicate.id)!, duplicate: true };
        const title =
          options.title ||
          path.parse(filename).name.slice(0, 200) ||
          "未命名照片";
        db.prepare(
          `INSERT INTO photo(id,digest,storage_key,title,alt,width,height,mime_type,file_size,category,year,location,source,visibility,
        captured_at,camera_make,camera_model,lens_model,focal_length,aperture,shutter_speed,iso,is_sample,uploaded_at)
        VALUES (@id,@digest,@storageKey,@title,@alt,@width,@height,@mimeType,@fileSize,@category,@year,@location,@source,@visibility,
        @capturedAt,@cameraMake,@cameraModel,@lensModel,@focalLength,@aperture,@shutterSpeed,@iso,@isSample,@uploadedAt)`,
        ).run({
          id,
          digest,
          storageKey,
          title,
          alt: options.alt || title,
          width: rotated ? metadata.height : metadata.width,
          height: rotated ? metadata.width : metadata.height,
          mimeType,
          fileSize: size,
          category: options.category || "Landscape",
          year: options.year || capturedAt.slice(0, 4),
          location: options.location || "",
          source: options.source || "",
          visibility: options.visibility || "draft",
          capturedAt,
          cameraMake: String(exif?.Make || "").slice(0, 200),
          cameraModel: String(exif?.Model || "").slice(0, 200),
          lensModel: String(exif?.LensModel || "").slice(0, 200),
          focalLength: exif?.FocalLength ? `${exif.FocalLength} mm` : "",
          aperture: exif?.FNumber ? `f/${exif.FNumber}` : "",
          shutterSpeed:
            exposure > 0
              ? exposure < 1
                ? `1/${Math.round(1 / exposure)} s`
                : `${exposure} s`
              : "",
          iso: String(exif?.ISO || "").slice(0, 200),
          isSample: options.isSample ? 1 : 0,
          uploadedAt: new Date().toISOString(),
        });
        db.prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,?,?,?)").run(
          id,
          "original",
          originalName,
          mimeType,
        );
        if (copyright) {
          db.prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type,encoding_version) VALUES (?,?,?,?,?)")
            .run(id, "download", downloadName, mimeType, copyright.version);
        }
        for (const variant of previewVariants)
          db.prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type,encoding_version) VALUES (?,?,?,?,?)").run(
            id,
            variant.name,
            `${variant.name}.webp`,
            "image/webp",
            encodingVersion,
          );
        committed = true;
        return { photo: getPhoto(id)!, duplicate: false };
      })
      .immediate();
    if (!committed) await rm(destination, { recursive: true, force: true });
    return result;
  } catch (error) {
    if (!committed) await rm(destination, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw new AppError(
      "图片处理或保存失败，请检查图片格式和磁盘空间后重试",
      422,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export function getMediaRecord(id: string, variant: string) {
  return getDatabase()
    .prepare(
      `SELECT p.visibility, p.storage_key, p.is_sample, m.filename, m.mime_type, m.encoding_version FROM photo p
    JOIN media_variant m ON m.photo_id=p.id WHERE p.id=? AND m.variant=?`,
    )
    .get(id, variant) as
    | {
        visibility: Photo["visibility"];
        is_sample: number;
        encoding_version: number;
        storage_key: string;
        filename: string;
        mime_type: string;
      }
    | undefined;
}

export async function readMedia(
  record: NonNullable<ReturnType<typeof getMediaRecord>>,
) {
  return readFile(
    path.join(mediaDirectory, record.storage_key, record.filename),
  );
}

export function openMedia(record: NonNullable<ReturnType<typeof getMediaRecord>>) {
  return open(path.join(mediaDirectory, record.storage_key, record.filename), "r");
}

async function removeRetiredGrid(id: string, directory: string) {
  const record = getMediaRecord(id, "grid");
  if (!record) return false;
  // Only remove the known derived file; uploaded originals and download copies are never touched.
  if (record.filename === "grid.webp") await rm(path.join(directory, "grid.webp"), { force: true });
  return getDatabase().prepare("DELETE FROM media_variant WHERE photo_id=? AND variant='grid'").run(id).changes > 0;
}

export async function rebuildPhotoPreviews(id: string) {
  const db = getDatabase();
  const original = getMediaRecord(id, "original");
  if (!original) throw new AppError("原图不存在", 404);
  const copyright = original.is_sample ? undefined : getCopyrightSettings();
  const encodingVersion = copyright?.previewVersion ?? previewEncodingVersion;
  await ensureCopyrightDownload(id);
  const current = db.prepare(
    "SELECT variant FROM media_variant WHERE photo_id=? AND encoding_version=? AND variant!='original'",
  ).all(id, encodingVersion) as { variant: string }[];
  const directory = path.join(mediaDirectory, original.storage_key);
  if (previewVariants.every((variant) => current.some((row) => row.variant === variant.name))) {
    const retired = await removeRetiredGrid(id, directory);
    if (retired && original.visibility === "public") queuePreviewCachePurge(id);
    return retired;
  }
  const temporary = await mkdtemp(path.join(directory, ".previews-"));
  try {
    await generatePreviews(path.join(directory, original.filename), temporary, copyright);
    for (const variant of previewVariants)
      await rename(path.join(temporary, `${variant.name}.webp`), path.join(directory, `${variant.name}.webp`));
    db.transaction(() => {
      const save = db.prepare(`INSERT INTO media_variant(photo_id,variant,filename,mime_type,encoding_version)
        VALUES (?,?,?,?,?) ON CONFLICT(photo_id,variant) DO UPDATE SET
        filename=excluded.filename,mime_type=excluded.mime_type,encoding_version=excluded.encoding_version`);
      for (const variant of previewVariants)
        save.run(id, variant.name, `${variant.name}.webp`, "image/webp", encodingVersion);
    }).immediate();
    await removeRetiredGrid(id, directory);
    if (original.visibility === "public") queuePreviewCachePurge(id);
    return true;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const pendingDownloads = new Map<string, Promise<NonNullable<ReturnType<typeof getMediaRecord>> | undefined>>();

export function ensureCopyrightDownload(id: string) {
  const pending = pendingDownloads.get(id);
  if (pending) return pending;
  const task = createCopyrightDownload(id).finally(() => pendingDownloads.delete(id));
  pendingDownloads.set(id, task);
  return task;
}

async function createCopyrightDownload(id: string) {
  const original = getMediaRecord(id, "original");
  const copyright = getCopyrightSettings();
  if (!original || original.is_sample || !copyright) return original;
  const existing = getMediaRecord(id, "download");
  if (existing?.encoding_version === copyright.version) return existing;
  const directory = path.join(mediaDirectory, original.storage_key);
  const temporary = await mkdtemp(path.join(directory, ".copyright-"));
  const filename = `download${path.extname(original.filename)}`;
  try {
    await writeCopyrightDownload(path.join(directory, original.filename), path.join(temporary, filename), original.mime_type, copyright);
    await rename(path.join(temporary, filename), path.join(directory, filename));
    getDatabase().prepare(`INSERT INTO media_variant(photo_id,variant,filename,mime_type,encoding_version)
      VALUES (?,?,?,?,?) ON CONFLICT(photo_id,variant) DO UPDATE SET
      filename=excluded.filename,mime_type=excluded.mime_type,encoding_version=excluded.encoding_version`)
      .run(id, "download", filename, original.mime_type, copyright.version);
    return getMediaRecord(id, "download");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
