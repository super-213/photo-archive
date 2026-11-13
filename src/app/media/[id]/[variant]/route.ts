import { previewVariants, publicPreviewCacheSeconds } from "@/lib/media-settings";
import { Readable } from "node:stream";
import path from "node:path";
import { getAdministrator } from "@/lib/server/auth";
import { getMediaRecord, openMedia, openPhotoDownload } from "@/lib/server/media";
import { originalDownloadsEnabled } from "@/lib/server/media-policy";
import { getPhoto } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaContext = { params: Promise<{ id: string; variant: string }> };
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Cloudflare-CDN-Cache-Control": "no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function downloadDisposition(title: string, filename: string) {
  const name = (title || "照片").replace(/[\\/\u0000-\u001f\u007f]/g, "_") + path.extname(filename);
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`);
  return `attachment; filename="${filename}"; filename*=UTF-8''${encoded}`;
}

export async function GET(request: Request, context: MediaContext) {
  const { id, variant: requestedVariant } = await context.params;
  const webp = requestedVariant.endsWith(".webp");
  const name = webp ? requestedVariant.slice(0, -5) : requestedVariant;
  const legacyGrid = name === "grid";
  const variant = legacyGrid ? "preview" : name;
  const download = requestedVariant === "original" || requestedVariant === "download";
  if (download ? !originalDownloadsEnabled() : !previewVariants.some((item) => item.name === variant))
    return new Response(null, { status: 404, headers: privateHeaders });
  const record = download ? undefined : getMediaRecord(id, variant);
  const photo = download ? getPhoto(id) : record;
  if (!photo) return new Response(null, { status: 404, headers: privateHeaders });
  const restricted = photo.visibility !== "public";
  const administrator = restricted && await getAdministrator(request.headers);
  if (restricted && !administrator)
    return new Response(null, { status: 404, headers: privateHeaders });

  let file: Awaited<ReturnType<typeof openMedia>> | undefined;
  try {
    const attachment = download ? await openPhotoDownload(id) : undefined;
    const selected = attachment?.record || record!;
    file = attachment?.file || await openMedia(selected);
    const stat = await file.stat();
    // Recheck after asynchronous file access, before honoring any cache validator.
    const current = download ? getPhoto(id) : getMediaRecord(id, variant);
    if (!current || (current.visibility !== "public" && !administrator) || (download && !originalDownloadsEnabled()))
      return new Response(null, { status: 404, headers: privateHeaders });
    const cacheable = !download && current.visibility === "public";
    // Only canonical, public display URLs may be shared by the CDN. Downloads never qualify.
    const cdnCacheable = cacheable && webp && !legacyGrid && !new URL(request.url).search;
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const headers = {
      ...(cdnCacheable ? {
        // Reuse public display images in the browser and at Cloudflare for four hours.
        "Cache-Control": `private, max-age=${publicPreviewCacheSeconds}`,
        "Cloudflare-CDN-Cache-Control": `public, max-age=${publicPreviewCacheSeconds}, must-revalidate`,
      } : privateHeaders),
      ...(cacheable ? { ...(!cdnCacheable ? { "Cache-Control": "private, no-cache" } : {}), ETag: etag } : {}),
      "X-Content-Type-Options": "nosniff",
      "Content-Type": selected.mime_type,
      "Content-Disposition": download
        ? downloadDisposition("title" in current ? current.title : "", selected.filename)
        : `inline; filename="${selected.filename}"`,
    };
    const validators = request.headers.get("if-none-match")?.split(",").map((value) => value.trim().replace(/^W\//, ""));
    if (cacheable && validators?.some((value) => value === "*" || value === etag))
      return new Response(null, { status: 304, headers });
    const responseHeaders: Record<string, string> = {
      ...headers,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
    };
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    const ifRange = request.headers.get("if-range");
    const range = request.method === "GET" && (!ifRange || ifRange === etag) && request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: { ...privateHeaders, "Content-Range": `bytes */${stat.size}` },
        });
      }
      status = 206;
      responseHeaders["Content-Length"] = String(end - start + 1);
      responseHeaders["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    if (request.method === "HEAD") return new Response(null, { headers: responseHeaders });
    const handle = file;
    const source = handle.createReadStream({ start, end });
    const abort = () => source.destroy();
    request.signal.addEventListener("abort", abort, { once: true });
    source.once("close", () => {
      request.signal.removeEventListener("abort", abort);
      void handle.close().catch((error) => console.error("Media file close failed", error));
    });
    if (request.signal.aborted) source.destroy();
    const stream = Readable.toWeb(source) as ReadableStream<Uint8Array>;
    file = undefined; // The stream owns and closes the file, including on cancellation.
    return new Response(stream, { status, headers: responseHeaders });
  } catch {
    return new Response(null, { status: 404, headers: privateHeaders });
  } finally {
    await file?.close();
  }
}

export function HEAD(request: Request, context: MediaContext) {
  return GET(request, context);
}
