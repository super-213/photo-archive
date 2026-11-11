"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { categories, categoryLabels, publicPhotos, years } from "@/lib/content";
import { PhotoGallery } from "./photo-gallery";

export function Archive() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const category = searchParams.get("category") ?? "all";
  const year = searchParams.get("year") ?? "all";
  const filtered = publicPhotos.filter(
    (photo) =>
      (category === "all" || photo.category === category) &&
      (year === "all" || photo.year === year),
  );
  const hasFilters = category !== "all" || year !== "all";

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}${params.size ? `?${params.toString()}` : ""}`, {
      scroll: false,
    });
  }

  return (
    <>
      <div className="archive-toolbar">
        <div className="category-filters" role="group" aria-label="按题材筛选">
          <button
            aria-pressed={category === "all"}
            onClick={() => updateFilter("category", "all")}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              key={item}
              aria-pressed={category === item}
              onClick={() => updateFilter("category", item)}
            >
              {categoryLabels[item]}
              <span className="category-english"> {item}</span>
            </button>
          ))}
        </div>
        <div className="year-filter">
          <label htmlFor="year">年份</label>
          <select
            id="year"
            value={year}
            onChange={(event) => updateFilter("year", event.target.value)}
          >
            <option value="all">全部年份</option>
            {years.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
            {year !== "all" && !years.includes(year) && (
              <option value={year}>{year}</option>
            )}
          </select>
        </div>
      </div>
      <div className="archive-status">
        <p role="status" aria-live="polite">
          {String(filtered.length).padStart(2, "0")} photographs
        </p>
        {hasFilters && (
          <button
            className="reset-filter"
            onClick={() => router.push(pathname, { scroll: false })}
          >
            重置筛选 ×
          </button>
        )}
      </div>
      {filtered.length ? (
        <PhotoGallery key={`${category}-${year}`} photos={filtered} />
      ) : (
        <div className="empty-state">
          <h2>这里还没有照片。</h2>
          <p>试试其他题材或年份。</p>
          <button
            className="text-link"
            onClick={() => router.push(pathname, { scroll: false })}
          >
            查看全部照片 →
          </button>
        </div>
      )}
    </>
  );
}
