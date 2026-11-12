import Link from "next/link";

export default function NotFound() {
  return (
    <div className="not-found page-gutter">
      <p className="eyebrow">404</p>
      <h1>这一页还没有留下影像。</h1>
      <Link href="/" className="text-link">
        返回所见 →
      </Link>
    </div>
  );
}
