import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdministrator } from "@/lib/server/auth";
import { listProjects } from "@/lib/server/store";
import { getCover } from "@/lib/content";

export default async function ProjectsPage() {
  if (!(await getAdministrator(await headers()))) redirect("/admin");
  const projects = listProjects(false);
  return (
    <>
      <div className="admin-title">
        <div>
          <p className="eyebrow">策展</p>
          <h1>摄影系列</h1>
          <p className="admin-muted">
            选择封面，安排照片顺序与排版，发布到作品集。
          </p>
        </div>
        <Link className="admin-button" href="/admin/projects/new">
          创建系列 +
        </Link>
      </div>
      <div className="admin-project-list">
        {projects.map((project) => {
          const cover = getCover(project);
          return (
            <Link key={project.id} href={`/admin/projects/${project.id}`}>
              {cover ? (
                <Image
                  src={cover.thumbnailSrc}
                  alt={cover.alt}
                  width={180}
                  height={120}
                />
              ) : (
                <div className="admin-no-cover">待选封面</div>
              )}
              <div>
                <h2>{project.title}</h2>
                <p>
                  {project.subtitle} · {project.photos.length} 张照片 · 顺序{" "}
                  {project.sortOrder}
                </p>
              </div>
              <span>{project.status === "published" ? "已发布" : "草稿"}</span>
              <span aria-hidden="true">↗</span>
            </Link>
          );
        })}
        {!projects.length && (
          <p className="admin-empty admin-muted">创建第一个摄影系列。</p>
        )}
      </div>
    </>
  );
}
