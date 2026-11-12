import { readArchiveFilters } from "@/lib/archive-filters";
import { apiAction, json } from "@/lib/server/http";
import { listPhotoPage } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return apiAction(() => {
    const params = new URL(request.url).searchParams;
    const { category } = readArchiveFilters(params);
    return json(listPhotoPage(category, params.get("cursor") || undefined));
  });
}
