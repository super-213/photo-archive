import { renderShareImage, shareImageResponse } from "@/lib/server/share-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return shareImageResponse(await renderShareImage());
}
