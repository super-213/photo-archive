import { previewVariants } from "@/lib/media-settings";
import { Readable } from "node:stream";
import { getAdministrator } from "@/lib/server/auth";
import { ensureCopyrightDownload, getMediaRecord, openMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MediaContext = { params: Promise<{ id: string; variant: string }> };
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, context: MediaContext) {
  const { id, variant } = await context.params;
  if (variant !== "original" && !previewVariants.some((item) => item.name === variant))
    return new Response(null, { status: 404, headers: privateHeaders });
  let record = getMediaRecord(id, variant);
  if (!record) return new Response(null, { status: 404, headers: privateHeaders });
  const restricted = record.visibility !== "public";
  const administrator = restricted && await getAdministrator(request.headers);
  if (restricted && !administrator)
    return new Response(null, { status: 404, headers: privateHeaders });

  let file: Awaited<ReturnType<typeof openMedia>> | undefined;
  try {
    if (variant === "original") record = await ensureCopyrightDownload(id);
    if (!record) return new Response(null, { status: 404, headers: privateHeaders });
    file = await openMedia(record);
    const stat = await file.stat();
    // Recheck after asynchronous file access, before honoring any cache validator.
    const current = getMediaRecord(id, variant);
    if (!current || (current.visibility !== "public" && !administrator))
      return new Response(null, { status: 404, headers: privateHeaders });
    const cacheable = variant !== "original" && current.visibility === "public";
    const etag = `"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
    const headers = {
      ...privateHeaders,
      ...(cacheable ? { "Cache-Control": "private, no-cache", ETag: etag } : {}),
      "Content-Type": record.mime_type,
      "Content-Disposition": `${variant === "original" ? "attachment" : "inline"}; filename="${variant === "original" ? `original${record.filename.slice(record.filename.lastIndexOf("."))}` : record.filename}"`,
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
