"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return (
    <header className="site-header page-gutter">
      <nav aria-label="主导航">
        {[
          { href: "/", label: "所见" },
          { href: "/archive", label: "所藏" },
        ].map((link) => {
          const active =
            link.href === "/"
              ? pathname === "/" || pathname.startsWith("/works/")
              : pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
