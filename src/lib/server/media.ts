import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import exifr from "exifr";
import { mediaDirectory, getDatabase } from "./database";
import { getPhoto } from "./store";
import { AppError, captureDate } from "./validation";
import type { Category, Photo } from "../content";

export const maxUploadBytes = 32 * 1024 * 1024;
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

export async function importPhoto(
  buffer: Buffer,
  filename: string,
  options: ImportOptions = {},
) {
  if (!buffer.length || buffer.length > maxUploadBytes)
    throw new AppError("单张照片大小应在 1 字节至 32 MB 之间", 413);
  const db = getDatabase();
  const digest = createHash("sha256").update(buffer).digest("hex");
  const existing = db
    .prepare("SELECT id FROM photo WHERE digest=?")
    .get(digest) as { id: string } | undefined;
  if (existing) return { photo: getPhoto(existing.id)!, duplicate: true };
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: 80_000_000 }).metadata();
  } catch {
    throw new AppError(
      "无法读取图片，请上传有效的 JPEG、PNG、WebP、AVIF 或 TIFF 照片",
    );
  }
  if (
    !metadata.format ||
    !formats[metadata.format] ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages || 1) > 1
  ) {
    throw new AppError("请选择单帧 JPEG、PNG、WebP、AVIF 或 TIFF 照片");
  }
  const format =
    metadata.format === "heif" && metadata.compression === "av1"
      ? "avif"
      : metadata.format;
  const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  const id = options.id || randomUUID();
  const storageKey = randomUUID();
  const staging = await mkdtemp(path.join(mediaDirectory, ".upload-"));
  const destination = path.join(mediaDirectory, storageKey);
  let committed = false;
  try {
    const originalName = `original.${formats[format]}`;
    await writeFile(path.join(staging, originalName), buffer, { mode: 0o600 });
    const variants = [
      { name: "thumbnail", width: 420 },
      { name: "grid", width: 1440 },
      { name: "lightbox", width: 2560 },
    ];
    // Sharp discards source metadata by default. GPS and EXIF never enter preview files.
    for (const variant of variants) {
      await sharp(buffer, { limitInputPixels: 80_000_000 })
        .rotate()
        .resize({
          width: variant.width,
          height: variant.width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: variant.name === "lightbox" ? 90 : 82 })
        .toFile(path.join(staging, `${variant.name}.webp`));
    }
    const exif = await exifr
      .parse(buffer, {
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
          fileSize: buffer.length,
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
        db.prepare("INSERT INTO media_variant VALUES (?,?,?,?)").run(
          id,
          "original",
          originalName,
          mimeType,
        );
        for (const variant of variants)
          db.prepare("INSERT INTO media_variant VALUES (?,?,?,?)").run(
            id,
            variant.name,
            `${variant.name}.webp`,
            "image/webp",
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
      `SELECT p.visibility, p.storage_key, m.filename, m.mime_type FROM photo p
    JOIN media_variant m ON m.photo_id=p.id WHERE p.id=? AND m.variant=?`,
    )
    .get(id, variant) as
    | {
        visibility: Photo["visibility"];
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
