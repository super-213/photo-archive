import type { Metadata } from "next";
import { Suspense } from "react";
import { listPhotos } from "@/lib/server/store";
import { Archive } from "@/components/archive";

export const metadata: Metadata = { title: "所藏" };

export const dynamic = "force-dynamic";

export default function ArchivePage() {
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
        <Archive photos={listPhotos()} />
      </Suspense>
    </div>
  );
}
