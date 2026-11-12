"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { archivePageSize, categories, categoryLabels, type Category, type PhotoPage } from "@/lib/content";
import { legacyArchiveFilterKeys } from "@/lib/archive-filters";
import { PhotoGallery } from "./photo-gallery";
import { Adjustments, Close } from "./icons";

export function Archive({ category, initialPage }: {
  category: Category | "all";
  initialPage: PhotoPage;
}) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const pathname = usePathname();
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
      startTransition(() => router.push(nextUrl, { scroll: false }));
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
          {navigating ? "正在加载照片…" : `${initialPage.total} 张照片`}
        </p>
        <button
          type="button"
          className="archive-filter-toggle"
          ref={filterToggle}
          aria-label={
            category === "all"
              ? "按题材筛选"
              : `按题材筛选，当前${categoryLabels[category]}`
          }
          aria-expanded={filterOpen}
          aria-controls={filterId}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <span>
            {category === "all" ? "全部题材" : categoryLabels[category]}
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
              aria-pressed={category === "all"}
              onClick={() => updateCategory("all")}
            >
              全部
            </button>
            {categories.map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={category === item}
                onClick={() => updateCategory(item)}
              >
                {categoryLabels[item]}
              </button>
            ))}
          </div>
        </div>
      </div>
      {initialPage.total ? (
        <PagedGallery key={category} category={category} initialPage={initialPage} />
      ) : (
        <div className="empty-state">
          <h2>这里还没有照片。</h2>
          <p>选择其他题材，再试一次。</p>
          <button type="button" className="text-link" onClick={() => updateCategory("all")}>
            查看全部照片 →
          </button>
        </div>
      )}
    </>
  );
}

function PagedGallery({ category, initialPage }: {
  category: Category | "all";
  initialPage: PhotoPage;
}) {
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function loadMore() {
    if (!page.nextCursor || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ category, cursor: page.nextCursor });
      const response = await fetch(`/api/photos/page?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("照片加载失败，请重试");
      const next: PhotoPage = await response.json();
      setPage((current) => {
        const photos = new Map(current.photos.map((photo) => [photo.id, photo]));
        next.photos.forEach((photo) => photos.set(photo.id, photo));
        return { ...next, photos: [...photos.values()] };
      });
    } catch {
      if (!controller.signal.aborted) setError("照片加载失败，请重试");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <>
      <PhotoGallery photos={page.photos} batchSize={archivePageSize} />
      {page.nextCursor && (
        <div className="archive-pagination">
          {error && <p role="alert">{error}</p>}
          <button type="button" className="text-link" disabled={loading} onClick={() => void loadMore()}>
            {loading ? "正在加载…" : error ? "重试加载" : "加载更多照片"}
          </button>
        </div>
      )}
    </>
  );
}
