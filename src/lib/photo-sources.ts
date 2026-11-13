import type { PhotoLayout, PhotoSource } from "./content";
import { previewVariants } from "./media-settings";

export function photoSources(photo: PhotoSource, variant: "preview" | "lightbox" = "preview") {
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

export function layoutImageSizes(layout: PhotoLayout, index: number) {
  const widths = {
    full: 90,
    center: 58,
    pair: 44,
    asymmetric: 44,
    "large-small": index === 0 ? 55 : 33,
    triptych: layout.photoIds.length === 2 ? 44 : 29,
  };
  const desktopWidth = layout.photoIds.length === 1 && layout.type !== "full"
    ? 58 : widths[layout.type];
  return `(max-width: 767px) 90vw, ${desktopWidth}vw`;
}

export function lightboxImageSizes(photo: PhotoSource, width: number, height: number, scale = 1) {
  return `${Math.ceil(Math.min(width, height * photo.width / photo.height) * scale)}px`;
}
