import type { MetadataRoute } from "next";
import { publicSiteUrl } from "@/lib/seo";
import { listProjectCovers } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicSiteUrl();
  if (!origin) return [];
  // Query current publication state on every request; never list drafts or private photos.
  return ["/", "/archive", ...listProjectCovers().map((project) => `/works/${encodeURIComponent(project.slug)}`)]
    .map((pathname) => ({ url: new URL(pathname, origin).href }));
}
