import type { Photo } from "./content";
import { previewVariants } from "./media-settings";

export function photoSources(photo: Photo, variant: "preview" | "lightbox" = "preview") {
  const src = variant === "lightbox" ? photo.lightboxSrc : photo.previewSrc || photo.src;
  // Old records without a known preview size use their fallback without a misleading width descriptor.
  if (variant === "preview" && !photo.previewSrc) return { src, srcSet: undefined };
  const urls = { thumbnail: photo.thumbnailSrc, preview: photo.previewSrc, lightbox: photo.lightboxSrc };
  const sources = new Map<number, string>();
  for (const item of previewVariants) {
    if (variant !== "lightbox" && item.name === "lightbox") continue;
    const source = urls[item.name];
    if (!source) continue;
    const width = Math.round(photo.width * Math.min(1, item.width / Math.max(photo.width, photo.height)));
    if (!sources.has(width)) sources.set(width, source);
  }
  return { src, srcSet: [...sources].map(([width, source]) => `${source} ${width}w`).join(", ") };
}
