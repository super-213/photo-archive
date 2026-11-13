import type { Metadata, Viewport } from "next";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "@fontsource-variable/noto-serif-sc";
import "@fontsource-variable/noto-sans-sc";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { site } from "@/lib/content";
import { publicSiteUrl, serializeJsonLd } from "@/lib/seo";
import { WebVitals } from "@/components/web-vitals";

export const metadata: Metadata = {
  applicationName: site.name,
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "default" },
  metadataBase: publicSiteUrl() || new URL("http://localhost:3000"),
  title: {
    default: `${site.name} — 摄影作品集`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  robots: publicSiteUrl() ? undefined : { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#f7f6f2", colorScheme: "light" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const origin = publicSiteUrl();
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>
        <WebVitals />
        {origin && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd({
          "@context": "https://schema.org", "@type": "WebSite",
          name: site.name, description: site.description, url: origin.href, inLanguage: "zh-CN",
        }) }} />}
        <a className="skip-link" href="#main">
          跳转到主要内容
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
