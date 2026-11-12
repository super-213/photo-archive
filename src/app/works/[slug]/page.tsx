import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { Arrow } from "@/components/icons";
import { PhotoGallery } from "@/components/photo-gallery";
import { categoryLabels, getProjectPhotos } from "@/lib/content";
import { getPublishedProject, getNextPublishedProject } from "@/lib/server/store";
export const dynamic = "force-dynamic";
const readProject = cache(getPublishedProject);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const project = readProject(slug);
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
  const project = readProject(slug);
  if (!project) notFound();
  const next = getNextPublishedProject(project);
  return (
    <article className="project-page page-gutter">
      <Link className="text-link back-link" href="/">
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
      {next && (
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
