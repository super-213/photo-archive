import { pageMetadata } from "@/lib/seo";
import { listPhotoPage } from "@/lib/server/store";
import { readArchiveFilters } from "@/lib/archive-filters";
import { Archive } from "@/components/archive";

export const metadata = pageMetadata("所藏", "浏览片隅的公开摄影档案，按题材探索风光、街拍、旅行与生活中的瞬间。", "/archive");

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
      <Archive category={category} initialPage={listPhotoPage(category)} />
    </div>
  );
}
