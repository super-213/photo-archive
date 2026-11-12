"use client";

import { usePathname } from "next/navigation";
import { site } from "@/lib/content";

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <footer className="site-footer page-gutter">
      <p>{site.name} / <span lang="en">PHOTOGRAPHY</span></p>
      <p lang="en">{site.tagline}</p>
    </footer>
  );
}
