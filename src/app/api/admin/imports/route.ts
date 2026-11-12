import { apiAction, json, requireAdministrator } from "@/lib/server/http";
import { getFolderImportStatus } from "@/lib/server/folder-import";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiAction(async () => {
    await requireAdministrator(request);
    return json(getFolderImportStatus());
  });
}
