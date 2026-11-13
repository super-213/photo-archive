export const maxUploadBytes = 256 * 1024 * 1024;
export const maxInputPixels = 240_000_000;
export const previewEncodingVersion = 5;
export const publicPreviewCacheSeconds = 4 * 60 * 60;
export const previewVariants = [
  { name: "thumbnail", width: 420 },
  { name: "preview", width: 840 },
  { name: "lightbox", width: 2560 },
] as const;
