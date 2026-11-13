"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { PhotoPreload } from "@/lib/content";
import { canPreloadPhotos, preloadPhoto } from "@/lib/photo-preload";

export function ProjectLink({ href, className, previews, children }: {
  href: string;
  className: string;
  previews: PhotoPreload[];
  children: ReactNode;
}) {
  const [intent, setIntent] = useState(false);
  function prepare() {
    if (!canPreloadPhotos()) return;
    setIntent(true);
    previews.forEach(({ photo, sizes }) => { void preloadPhoto(photo, sizes); });
  }
  return (
    <Link
      href={href}
      className={className}
      prefetch={intent ? true : null}
      onPointerEnter={(event) => { if (event.pointerType !== "touch") prepare(); }}
      onFocus={prepare}
      onPointerDown={prepare}
    >
      {children}
    </Link>
  );
}
