"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { categories, categoryLabels, type Photo } from "@/lib/content";
import {
  legacyArchiveFilterKeys,
  filterArchivePhotos,
  readArchiveFilters,
} from "@/lib/archive-filters";
import { PhotoGallery } from "./photo-gallery";

export function Archive({ photos }: { photos: Photo[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const filters = readArchiveFilters(searchParams);
  const filtered = filterArchivePhotos(photos, filters);

  function updateCategory(category: string) {
    const params = new URLSearchParams(window.location.search);
    legacyArchiveFilterKeys.forEach((key) => params.delete(key));
    if (category === "all") params.delete("category");
    else params.set("category", category);
    const nextUrl = `${pathname}${params.size ? `?${params}` : ""}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`)
      window.history.pushState(null, "", nextUrl);
  }

  return (
    <>
      <div className="archive-toolbar">
        <div className="category-filters" role="group" aria-label="按题材筛选">
          <button
            type="button"
            aria-pressed={filters.category === "all"}
            onClick={() => updateCategory("all")}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={filters.category === item}
              onClick={() => updateCategory(item)}
            >
              {categoryLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <p className="archive-status" role="status" aria-live="polite">
        {String(filtered.length).padStart(2, "0")} photographs
      </p>
      {filtered.length ? (
        <PhotoGallery key={filters.category} photos={filtered} />
      ) : (
        <div className="empty-state">
          <h2>这里还没有照片。</h2>
          <p>选择其他题材，再试一次。</p>
          <button
            type="button"
            className="text-link"
            onClick={() => updateCategory("all")}
          >
            查看全部照片 →
          </button>
        </div>
      )}
    </>
  );
}
