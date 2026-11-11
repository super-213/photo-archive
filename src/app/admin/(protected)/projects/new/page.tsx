import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { listPhotos } from "@/lib/server/store";
import { ProjectEditor } from "@/components/admin/projects";
export default async function NewProjectPage() {
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  return <ProjectEditor initialProject={null} photos={listPhotos(false)} />;
}
