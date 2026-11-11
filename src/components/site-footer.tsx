import Link from "next/link";
import { site } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="site-footer page-gutter">
      <div>
        <Link href="/" className="footer-brand">
          {site.name}.
        </Link>
        <p>风景，日常，以及值得留下的片刻。</p>
      </div>
      <div className="footer-note">
        <span>示例作品集 · 图片来自 Unsplash</span>
        <Link href="/about#credits">查看素材来源 ↗</Link>
      </div>
    </footer>
  );
}
