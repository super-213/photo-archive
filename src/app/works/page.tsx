import type { Metadata } from "next";
import { ProjectCover } from "@/components/project-cover";
import { projects } from "@/lib/content";

export const metadata: Metadata = { title: "Works · 精选系列" };

export default function Works() {
  return (
    <div className="page-gutter works-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">精选摄影系列</p>
          <h1>
            Selected <em>works.</em>
          </h1>
        </div>
        <p>
          以照片为线索，
          <br />
          把片刻编成故事。
        </p>
      </header>
      <div className="editorial-grid">
        {projects.map((project, index) => (
          <ProjectCover key={project.slug} project={project} index={index} />
        ))}
      </div>
    </div>
  );
}
