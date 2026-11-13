"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { site } from "@/lib/content";
import { BrandLogo } from "./brand-logo";

function NavigationLabel({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className="navigation-label" aria-busy={pending}>{children}</span>;
}

export function SiteHeader() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  return (
    <header className="site-header page-gutter">
      <Link href="/" prefetch={true} className="wordmark" aria-label={`${site.name}，返回所见`}>
        <BrandLogo />
      </Link>
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
              // Both sections are dynamic; automatic prefetch only loads their fallback.
              prefetch={true}
              aria-current={active ? "page" : undefined}
            >
              <NavigationLabel>{link.label}</NavigationLabel>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
