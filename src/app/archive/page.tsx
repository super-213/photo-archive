import type { Metadata } from "next";
import { Suspense } from "react";
import { listPhotos } from "@/lib/server/store";
import { Archive } from "@/components/archive";

export const metadata: Metadata = { title: "Archive · 照片档案" };

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  return (
    <div className="archive-page page-gutter">
      <header className="page-heading">
        <div>
          <p className="eyebrow">照片档案</p>
          <h1>
            The <em>archive.</em>
          </h1>
        </div>
        <p>
          山川与街巷，
          <br />
          还有日常里的微小世界。
        </p>
      </header>
      <Suspense
        fallback={
          <p className="loading-state" role="status">
            正在加载照片档案…
          </p>
        }
      >
        <Archive photos={listPhotos()} />
      </Suspense>
    </div>
  );
}
