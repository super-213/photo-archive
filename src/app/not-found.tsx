import Link from "next/link";

export default function NotFound() {
  return (
    <div className="not-found page-gutter">
      <p className="eyebrow">404</p>
      <h1>这一页还没有留下影像。</h1>
      <Link href="/works" className="text-link">
        返回摄影系列 →
      </Link>
    </div>
  );
}
