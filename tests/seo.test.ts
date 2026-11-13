import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { pageMetadata, publicSiteUrl, serializeJsonLd } from "../src/lib/seo";

const directory = await mkdtemp(path.join(os.tmpdir(), "photo-archive-seo-"));
process.env.PHOTO_ARCHIVE_DATA_DIR = directory;
delete process.env.PHOTO_ARCHIVE_SITE_URL;
delete process.env.BETTER_AUTH_URL;
const { getDatabase, mediaDirectory } = await import("../src/lib/server/database");
const { default: sitemap } = await import("../src/app/sitemap");
const { default: robots } = await import("../src/app/robots");
const { GET: share } = await import("../src/app/share/[slug]/route");
const { GET: brandShare } = await import("../src/app/share/route");
const db = getDatabase();
after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

test("local setup is not indexed; public metadata uses only the configured origin", () => {
  assert.equal(publicSiteUrl(), undefined);
  assert.deepEqual(pageMetadata("所见", "描述", "/").robots, { index: false, follow: false });
  assert.deepEqual(sitemap(), []);
  assert.deepEqual(robots().rules, { userAgent: "*", disallow: "/" });
  process.env.BETTER_AUTH_URL = "https://photos.example.test";
  assert.equal(publicSiteUrl()?.origin, "https://photos.example.test");
  process.env.PHOTO_ARCHIVE_SITE_URL = "https://gallery.example.test";
  const metadata = pageMetadata("海边", "系列描述", "/works/sea", "/share/sea");
  assert.deepEqual(metadata.title, { absolute: "海边 | 片隅" });
  assert.equal(metadata.alternates?.canonical, "https://gallery.example.test/works/sea");
  assert.equal(metadata.openGraph?.url, "https://gallery.example.test/works/sea");
  assert.ok(metadata.twitter && "card" in metadata.twitter);
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.deepEqual(metadata.openGraph?.images, [{ url: "/share/sea", width: 1200, height: 630, alt: "海边 · 片隅摄影作品集" }]);
  assert.equal(robots().sitemap, "https://gallery.example.test/sitemap.xml");
  assert.ok(!JSON.stringify(robots()).includes("/share"), "sharing crawlers must be able to fetch images");
  for (const invalid of ["ftp://photos.example.test", "https://user:pass@photos.example.test", "https://photos.example.test/path", "https://photos.example.test/?token=secret", "https://photos.example.test/#fragment"]) {
    process.env.PHOTO_ARCHIVE_SITE_URL = invalid;
    assert.throws(publicSiteUrl);
  }
  process.env.PHOTO_ARCHIVE_SITE_URL = "https://gallery.example.test";
  const hostile = "</script><script>alert(1)</script>";
  const serialized = serializeJsonLd({ name: hostile });
  assert.ok(!serialized.includes("<"));
  assert.deepEqual(JSON.parse(serialized), { name: hostile });
});

test("sitemap and share previews include only currently published, fully public series", async () => {
  const photo = db.prepare(`INSERT INTO photo(id,digest,storage_key,title,alt,width,height,mime_type,file_size,category,visibility,uploaded_at)
    VALUES (?,?,?,?,?,40,30,'image/webp',100,'Travel',?,'2026-11-13')`);
  photo.run("public", "public", "public", "公开照片", "公开照片", "public");
  photo.run("private", "private", "private", "私有照片", "私有照片", "private");
  const project = db.prepare("INSERT INTO project(id,slug,title,category,cover_photo_id,status) VALUES (?,?,?,'Travel',?,?)");
  project.run("sea", "sea", "海边", "public", "published");
  project.run("draft", "draft", "草稿系列", "public", "draft");
  project.run("mixed", "mixed", "混合系列", "public", "published");
  db.exec(`INSERT INTO project_photo(project_id,photo_id,sort_order) VALUES
    ('sea','public',0),('draft','public',0),('mixed','public',0),('mixed','private',1)`);
  await mkdir(path.join(mediaDirectory, "public"));
  await writeFile(path.join(mediaDirectory, "public/lightbox.webp"), await sharp({ create: { width: 40, height: 30, channels: 3, background: "#577c8a" } }).webp().toBuffer());
  db.prepare("INSERT INTO media_variant(photo_id,variant,filename,mime_type) VALUES ('public','lightbox','lightbox.webp','image/webp')").run();
  assert.deepEqual(sitemap().map((entry) => entry.url), [
    "https://gallery.example.test/", "https://gallery.example.test/archive", "https://gallery.example.test/works/sea",
  ]);
  const response = await share(new Request("https://gallery.example.test/share/sea"), { params: Promise.resolve({ slug: "sea" }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  const image = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  for (const slug of ["draft", "mixed", "missing"]) {
    assert.equal((await share(new Request(`https://gallery.example.test/share/${slug}`), { params: Promise.resolve({ slug }) })).status, 404);
  }
  db.prepare("UPDATE photo SET visibility='private' WHERE id='public'").run();
  assert.equal(sitemap().length, 2);
  assert.equal((await share(new Request("https://gallery.example.test/share/sea"), { params: Promise.resolve({ slug: "sea" }) })).status, 404);
});

test("brand preview is a complete 1200 by 630 JPEG without any database dependency", async () => {
  const response = await brandShare();
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 630);
});
