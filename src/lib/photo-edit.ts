import type { Photo } from "./content";

const textFields = [
  "title", "alt", "description", "visibility", "category", "year", "capturedAt", "location",
  "cameraMake", "cameraModel", "lensModel", "focalLength", "aperture", "shutterSpeed", "iso",
] as const;

export function getPhotoChanges(photo: Photo, form: FormData) {
  const changes: Record<string, string | string[] | number> = { version: photo.version };
  for (const field of textFields) {
    const value = form.get(field);
    if (typeof value === "string" && value.trim() !== photo[field]) changes[field] = value.trim();
  }
  const value = form.get("tags");
  if (typeof value === "string") {
    const tags = [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
    if (tags.length !== photo.tags.length || tags.some((tag) => !photo.tags.includes(tag))) changes.tags = tags;
  }
  return changes;
}
