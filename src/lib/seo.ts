import type { Metadata } from "next";
import { site } from "./content";

// Use a configured origin rather than trusting incoming Host / forwarded headers.
export function publicSiteUrl(): URL | undefined {
  const configured = process.env.PHOTO_ARCHIVE_SITE_URL || process.env.BETTER_AUTH_URL;
  if (!configured) return undefined;
  const url = new URL(configured);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PHOTO_ARCHIVE_SITE_URL / BETTER_AUTH_URL 必须是完整的 HTTP(S) 站点域名，不含路径、查询参数或账号");
  }
  return url;
}

export function pageMetadata(title: string, description: string, pathname: string, image = "/share"): Metadata {
  const url = publicSiteUrl();
  const fullTitle = `${title} | ${site.name}`;
  return {
    title: { absolute: fullTitle },
    description,
    alternates: url ? { canonical: new URL(pathname, url).href } : undefined,
    robots: url ? { index: true, follow: true } : { index: false, follow: false },
    openGraph: {
      type: "website", locale: "zh_CN", siteName: site.name,
      title: fullTitle, description,
      url: url ? new URL(pathname, url).href : undefined,
      images: [{ url: image, width: 1200, height: 630, alt: `${title} · ${site.name}摄影作品集` }],
    },
    twitter: {
      card: "summary_large_image", title: fullTitle, description,
      images: [{ url: image, alt: `${title} · ${site.name}摄影作品集` }],
    },
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
