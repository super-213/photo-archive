import { getPublishedProject } from "@/lib/server/store";
import { getMediaRecord, readMedia } from "@/lib/server/media";
import { renderShareImage, shareImageResponse } from "@/lib/server/share-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = getPublishedProject(slug);
  const notFound = () => new Response(null, { status: 404, headers: {
    "Cache-Control": "private, no-store", "Cloudflare-CDN-Cache-Control": "no-store",
  } });
  if (!project) return notFound();
  const record = getMediaRecord(project.coverPhotoId, "lightbox") || getMediaRecord(project.coverPhotoId, "preview");
  let photo: Buffer | undefined;
  if (record?.visibility === "public") {
    try { photo = await readMedia(record); }
    catch { /* Keep sharing available with the brand card if a derivative is missing. */ }
  }
  const image = await renderShareImage(photo);
  const current = getPublishedProject(slug);
  if (!current || current.coverPhotoId !== project.coverPhotoId) return notFound();
  return shareImageResponse(image);
}
