import type { Metadata } from "next";
import { ProjectCover } from "@/components/project-cover";
import { listProjectCovers } from "@/lib/server/store";
import { site } from "@/lib/content";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: { absolute: `所见 | ${site.name}` } };

export default function Works() {
  const projects = listProjectCovers();
  return (
    <div className="page-gutter works-page">
      <header className="page-heading">
        <h1>所见</h1>
      </header>
      {!projects.length && <p className="empty-state">摄影系列正在整理中。</p>}
      <div className="editorial-grid">
        {projects.map((project, index) => (
          <ProjectCover key={project.slug} project={project} index={index} />
        ))}
      </div>
    </div>
  );
}
