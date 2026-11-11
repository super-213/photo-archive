import { getAdministrator } from "@/lib/server/auth";
import { getMediaRecord, readMedia } from "@/lib/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; variant: string }> },
) {
  const { id, variant } = await context.params;
  const record = getMediaRecord(id, variant);
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  };
  if (!record) return new Response(null, { status: 404, headers });
  if (
    (variant === "original" || record.visibility !== "public") &&
    !(await getAdministrator(request.headers))
  )
    return new Response(null, { status: 404, headers });
  try {
    const bytes = await readMedia(record);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": record.mime_type,
        "Content-Disposition": `${variant === "original" ? "attachment" : "inline"}; filename="${record.filename}"`,
      },
    });
  } catch {
    return new Response(null, { status: 404, headers });
  }
}
