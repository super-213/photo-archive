import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { getProject, listPhotos } from "@/lib/server/store";
import { ProjectEditor } from "@/components/admin/projects";
export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  return <ProjectEditor initialProject={project} photos={listPhotos(false)} />;
}
