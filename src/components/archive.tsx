"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { categories, categoryLabels, type Photo } from "@/lib/content";
import {
  legacyArchiveFilterKeys,
  filterArchivePhotos,
  readArchiveFilters,
} from "@/lib/archive-filters";
import { PhotoGallery } from "./photo-gallery";
import { Adjustments, Close } from "./icons";

export function Archive({ photos }: { photos: Photo[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const filters = readArchiveFilters(searchParams);
  const filtered = filterArchivePhotos(photos, filters);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterId = useId();
  const filterControl = useRef<HTMLDivElement>(null);
  const filterToggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    function closeOutside(event: MouseEvent) {
      if (!filterControl.current?.contains(event.target as Node))
        setFilterOpen(false);
    }
    function closeAfterTab(event: KeyboardEvent) {
      if (event.key === "Tab" &&
          !filterControl.current?.contains(document.activeElement))
        setFilterOpen(false);
    }
    document.addEventListener("click", closeOutside);
    document.addEventListener("keyup", closeAfterTab);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keyup", closeAfterTab);
    };
  }, [filterOpen]);

  function updateCategory(category: string) {
    const params = new URLSearchParams(window.location.search);
    legacyArchiveFilterKeys.forEach((key) => params.delete(key));
    if (category === "all") params.delete("category");
    else params.set("category", category);
    const nextUrl = `${pathname}${params.size ? `?${params}` : ""}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`)
      window.history.pushState(null, "", nextUrl);
    setFilterOpen(false);
    filterToggle.current?.focus();
  }

  return (
    <>
      <div
        className="archive-toolbar"
        data-filter-open={filterOpen}
        ref={filterControl}
        onKeyDown={(event) => {
          if (event.key === "Escape" && filterOpen) {
            event.preventDefault();
            event.stopPropagation();
            setFilterOpen(false);
            filterToggle.current?.focus();
          }
        }}
      >
        <p className="archive-status" role="status" aria-live="polite">
          {filtered.length} 张照片
        </p>
        <button
          type="button"
          className="archive-filter-toggle"
          ref={filterToggle}
          aria-label={
            filters.category === "all"
              ? "按题材筛选"
              : `按题材筛选，当前${categoryLabels[filters.category]}`
          }
          aria-expanded={filterOpen}
          aria-controls={filterId}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <span>
            {filters.category === "all" ? "全部题材" : categoryLabels[filters.category]}
          </span>
          {filterOpen ? <Close /> : <Adjustments />}
        </button>
        <div
          id={filterId}
          className="archive-filter-panel"
          hidden={!filterOpen}
        >
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
      </div>
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
