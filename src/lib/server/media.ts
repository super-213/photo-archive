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

import { createCopyrightXmp, getCopyrightSettings, writePreviewCopyright, type CopyrightSettings } from "./copyright";
import { maxUploadBytes, maxInputPixels, previewEncodingVersion, previewVariants } from "../media-settings";
import { queuePreviewCachePurge } from "./cdn-cache";
import { originalDownloadsEnabled } from "./media-policy";
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

async function generatePreviews(
  source: string,
  directory: string,
  copyright: CopyrightSettings | undefined,
  variants: readonly (typeof previewVariants)[number][] = previewVariants,
) {
  for (const variant of variants) {
    const image = sharp(source, { limitInputPixels: maxInputPixels })
      .rotate()
      .resize({ width: variant.width, height: variant.width, fit: "inside", withoutEnlargement: true })
      .keepIccProfile();
    if (copyright) image.withXmp(createCopyrightXmp(copyright));
    await image.webp({ quality: 90, effort: 4 })
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
    const originalFile = path.join(staging, "source");
    await copyFile(source, originalFile);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(originalFile)) hash.update(chunk);
    const digest = hash.digest("hex");
    const existing = db.prepare("SELECT id FROM photo WHERE digest=?").get(digest) as { id: string } | undefined;
    if (existing) {
      await rebuildPhotoPreviews(existing.id, originalFile);
      if (originalDownloadsEnabled()) await retainUploadedOriginal(existing.id, originalFile);
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
    const copyright = options.isSample ? undefined : getCopyrightSettings();
    const encodingVersion = copyright?.previewVersion ?? previewEncodingVersion;
    await generatePreviews(originalFile, staging, copyright);
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
    const originalName = `original.${formats[format]}`;
    const keepOriginal = originalDownloadsEnabled();
    if (keepOriginal) await rename(originalFile, path.join(staging, originalName));
    else await rm(originalFile);
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
        if (keepOriginal)
          db.prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'original',?,?)")
            .run(id, originalName, mimeType);
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

async function retainUploadedOriginal(id: string, source: string) {
  const db = getDatabase();
  const photo = db.prepare("SELECT storage_key,mime_type FROM photo WHERE id=?").get(id) as { storage_key: string; mime_type: string };
  const extension = formats[photo.mime_type.slice("image/".length)];
  if (!extension) throw new AppError("源照片格式无法识别");
  const directory = path.join(mediaDirectory, photo.storage_key);
  const filename = `original.${extension}`;
  const temporary = path.join(directory, `.original-${randomUUID()}.tmp`);
  try {
    await copyFile(source, temporary);
    await rename(temporary, path.join(directory, filename));
    db.prepare(`INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES (?,'original',?,?)
      ON CONFLICT(photo_id,variant) DO UPDATE SET filename=excluded.filename,mime_type=excluded.mime_type`)
      .run(id, filename, photo.mime_type);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function openPhotoDownload(id: string) {
  if (!originalDownloadsEnabled()) throw new AppError("照片下载已关闭", 404);
  const original = getMediaRecord(id, "original");
  if (original) {
    try { return { record: original, file: await openMedia(original) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  // Use actual image dimensions so legacy libraries and missing files also fall back correctly.
  const candidates: { record: NonNullable<ReturnType<typeof getMediaRecord>>; pixels: number }[] = [];
  for (const variant of ["lightbox", "grid", "preview", "thumbnail"]) {
    const record = getMediaRecord(id, variant);
    if (!record) continue;
    try {
      // Read current bytes rather than a path that libvips may have cached before a rebuild.
      const metadata = await sharp(await readMedia(record)).metadata();
      if (metadata.width && metadata.height) candidates.push({ record, pixels: metadata.width * metadata.height });
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "EACCES") throw error; }
  }
  candidates.sort((a, b) => b.pixels - a.pixels);
  for (const { record } of candidates) {
    try { return { record, file: await openMedia(record) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  throw new AppError("没有可下载的照片文件", 404);
}

// Read RIFF chunk boundaries rather than searching compressed image or XMP bytes.
function isLossyWebp(bytes: Buffer) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) return false;
    if (bytes.toString("ascii", offset, offset + 4) === "VP8 ") return true;
    offset += 8 + size + (size % 2);
  }
  return false;
}

async function removeRetiredMedia(id: string, directory: string) {
  const filenames = {
    grid: /^grid\.webp$/,
    download: /^download\.(?:jpe?g|png|webp|avif|heif|heic|tiff?)$/,
    original: /^original\.(?:jpe?g|png|webp|avif|heif|heic|tiff?)$/,
  };
  let changed = false;
  for (const [variant, pattern] of Object.entries(filenames)) {
    if (variant === "original" && originalDownloadsEnabled()) continue;
    const record = getMediaRecord(id, variant);
    if (!record) continue;
    if (!pattern.test(record.filename)) throw new AppError("历史媒体文件名异常，已保留文件，请检查媒体库");
    await rm(path.join(directory, record.filename), { force: true });
    getDatabase().prepare("DELETE FROM media_variant WHERE photo_id=? AND variant=?").run(id, variant);
    changed = true;
  }
  return changed;
}

export async function rebuildPhotoPreviews(id: string, uploadedSource?: string) {
  const db = getDatabase();
  const photo = db.prepare("SELECT storage_key,is_sample,visibility,width,height FROM photo WHERE id=?").get(id) as {
    storage_key: string; is_sample: number; visibility: Photo["visibility"]; width: number; height: number;
  } | undefined;
  if (!photo) throw new AppError("照片不存在", 404);
  const copyright = photo.is_sample ? undefined : getCopyrightSettings();
  const encodingVersion = copyright?.previewVersion ?? previewEncodingVersion;
  const directory = path.join(mediaDirectory, photo.storage_key);
  const original = getMediaRecord(id, "original");
  const states = await Promise.all(previewVariants.map(async (variant) => {
    const record = getMediaRecord(id, variant.name);
    let valid = false;
    let lossy = false;
    if (record) {
      try {
        const bytes = await readMedia(record);
        const metadata = await sharp(bytes, { limitInputPixels: maxInputPixels }).metadata();
        const scale = Math.min(1, variant.width / Math.max(photo.width, photo.height));
        valid = metadata.format === "webp" && (metadata.pages || 1) === 1 &&
          Math.abs((metadata.width || 0) - Math.round(photo.width * scale)) <= 1 &&
          Math.abs((metadata.height || 0) - Math.round(photo.height * scale)) <= 1;
        lossy = isLossyWebp(bytes);
        // A readable header alone is insufficient before deleting a legacy original.
        if (valid && original) await sharp(bytes, { limitInputPixels: maxInputPixels }).stats();
      } catch {
        // Missing or invalid displays must be regenerated before retiring sources.
        valid = false;
        lossy = false;
      }
    }
    return { variant, record, valid, lossy };
  }));
  const pending = states.filter(({ variant, record, valid, lossy }) =>
    !valid || !lossy || record?.encoding_version !== encodingVersion || record.filename !== `${variant.name}.webp`);
  if (pending.length) {
    const originalPath = original && path.join(directory, original.filename);
    const source = uploadedSource || (originalPath && await stat(originalPath).then((info) => info.isFile() ? originalPath : undefined).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }));
    const lightbox = states.find(({ variant }) => variant.name === "lightbox")!;
    if (!source && (!lightbox.valid || !lightbox.record))
      throw new AppError("缺少可用的大图，请重新导入源照片以修复展示图", 422);
    const temporary = await mkdtemp(path.join(directory, ".previews-"));
    try {
      if (source) {
        await generatePreviews(source, temporary, copyright, pending.map(({ variant }) => variant));
      } else {
        for (const { variant, record, valid, lossy } of pending) {
          if (valid && lossy && record) {
            await writePreviewCopyright(path.join(directory, record.filename), path.join(temporary, `${variant.name}.webp`), copyright);
          } else {
            await generatePreviews(path.join(directory, lightbox.record!.filename), temporary, copyright, [variant]);
          }
        }
      }
      // Generate every needed file before replacing displays or removing a legacy original.
      for (const { variant } of pending)
        await rename(path.join(temporary, `${variant.name}.webp`), path.join(directory, `${variant.name}.webp`));
      db.transaction(() => {
        const save = db.prepare(`INSERT INTO media_variant(photo_id,variant,filename,mime_type,encoding_version)
          VALUES (?,?,?,?,?) ON CONFLICT(photo_id,variant) DO UPDATE SET
          filename=excluded.filename,mime_type=excluded.mime_type,encoding_version=excluded.encoding_version`);
        for (const { variant } of pending)
          save.run(id, variant.name, `${variant.name}.webp`, "image/webp", encodingVersion);
      }).immediate();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const retired = await removeRetiredMedia(id, directory);
  const changed = pending.length > 0 || retired;
  if (changed && photo.visibility === "public") queuePreviewCachePurge(id);
  return changed;
}
