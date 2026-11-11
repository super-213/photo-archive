import { json } from "@/lib/server/http";
import { listPhotos } from "@/lib/server/store";
export const dynamic = "force-dynamic";
export function GET() {
  return json(listPhotos());
}
