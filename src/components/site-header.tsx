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
          { href: "/works", label: "Works" },
          { href: "/archive", label: "Archive" },
        ].map((link) => {
          const active = pathname.startsWith(link.href);
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
