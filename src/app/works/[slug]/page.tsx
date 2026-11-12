import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Arrow } from "@/components/icons";
import { PhotoGallery } from "@/components/photo-gallery";
import { categoryLabels, getProjectPhotos } from "@/lib/content";
import { listProjects } from "@/lib/server/store";
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const projects = listProjects();
  const project = projects.find((item) => item.slug === slug);
  return {
    title: project?.title ?? "系列未找到",
    description: project?.description,
  };
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const projects = listProjects();
  const project = projects.find((item) => item.slug === slug);
  if (!project) notFound();
  const next = projects[(projects.indexOf(project) + 1) % projects.length];
  return (
    <article className="project-page page-gutter">
      <Link className="text-link back-link" href="/works">
        <Arrow direction="left" /> 返回所见
      </Link>
      <header className="project-heading">
        {project.subtitle && (
          <p className="eyebrow">{project.subtitle}</p>
        )}
        <h1>{project.title}</h1>
        <div className="project-description">
          <span>
            {categoryLabels[project.category]} / {project.year}
          </span>
          <p>{project.description}</p>
        </div>
      </header>
      <PhotoGallery
        photos={getProjectPhotos(project)}
        layouts={project.layouts}
      />
      {projects.length > 1 && (
        <Link className="next-project" href={`/works/${next.slug}`}>
          <span className="eyebrow">下一个系列</span>
          <div>
            <h2>{next.title}</h2>
            <Arrow />
          </div>
        </Link>
      )}
    </article>
  );
}
