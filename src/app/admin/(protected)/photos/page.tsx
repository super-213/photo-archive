import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { listPhotos } from "@/lib/server/store";
import { PhotoManager } from "@/components/admin/photos";
import { getFolderImportStatus } from "@/lib/server/folder-import";

export default async function PhotosPage() {
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  return <PhotoManager initialPhotos={listPhotos(false)} initialFolderImport={getFolderImportStatus()} />;
}
