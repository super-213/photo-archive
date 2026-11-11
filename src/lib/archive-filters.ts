import { categories, type Category, type Photo } from "./content";

export const legacyArchiveFilterKeys = [
  "year",
  "location",
  "camera",
  "lens",
  "q",
] as const;
export type ArchiveFilters = { category: Category | "all" };

export function readArchiveFilters(
  params: Pick<URLSearchParams, "get">,
): ArchiveFilters {
  const category = (params.get("category") || "").trim();
  return {
    category: categories.includes(category as Category)
      ? (category as Category)
      : "all",
  };
}

export function filterArchivePhotos(photos: Photo[], filters: ArchiveFilters) {
  return photos.filter(
    (photo) =>
      photo.visibility === "public" &&
      (filters.category === "all" || photo.category === filters.category),
  );
}
