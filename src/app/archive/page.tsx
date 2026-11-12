import type { Metadata } from "next";
import { Suspense } from "react";
import { listPhotoPage } from "@/lib/server/store";
import { readArchiveFilters } from "@/lib/archive-filters";
import { Archive } from "@/components/archive";

export const metadata: Metadata = { title: "所藏" };

export const dynamic = "force-dynamic";

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawCategory = params.category;
  const { category } = readArchiveFilters(new URLSearchParams({
    category: Array.isArray(rawCategory) ? rawCategory[0] : rawCategory || "",
  }));
  return (
    <div className="archive-page page-gutter">
      <header className="page-heading">
        <h1>所藏</h1>
      </header>
      <Suspense
        fallback={
          <p className="loading-state" role="status">
            正在加载照片…
          </p>
        }
      >
        <Archive category={category} initialPage={listPhotoPage(category)} />
      </Suspense>
    </div>
  );
}
