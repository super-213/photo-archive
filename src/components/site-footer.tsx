"use client";

import { usePathname } from "next/navigation";
import { site } from "@/lib/content";
import { BrandLogo } from "./brand-logo";

export function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;

  return (
    <footer className="site-footer page-gutter">
      <p className="footer-brand"><BrandLogo small /><span lang="en">/ PHOTOGRAPHY</span></p>
      <p lang="en">{site.tagline}</p>
    </footer>
  );
}
