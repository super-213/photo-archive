import { PhotoImage } from "@/components/photo-image";
import Link from "next/link";
import { getCover, getProjectPhotos, type Project } from "@/lib/content";
import { Arrow } from "./icons";

export function ProjectCover({
  project,
  index,
}: {
  project: Project;
  index: number;
}) {
  const cover = getCover(project);
  if (!cover) return null;
  return (
    <Link
      href={`/works/${project.slug}`}
      className={`project-cover project-cover-${(index % 3) + 1}`}
    >
      <div className="cover-image">
        <PhotoImage photo={cover} sizes="(max-width: 767px) 90vw, 60vw" />
      </div>
      <div className="cover-caption">
        <div>
          <span className="eyebrow">
            {project.subtitle} / {getProjectPhotos(project).length} photographs
          </span>
          <h3>{project.title}</h3>
        </div>
        <Arrow />
      </div>
    </Link>
  );
}
