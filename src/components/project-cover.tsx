import { PhotoImage } from "@/components/photo-image";
import Link from "next/link";
import type { ProjectCoverData } from "@/lib/content";
import { Arrow } from "./icons";

export function ProjectCover({
  project,
  index,
}: {
  project: ProjectCoverData;
  index: number;
}) {
  const cover = project.cover;
  if (!cover) return null;
  return (
    <Link
      href={`/works/${project.slug}`}
      className={`project-cover project-cover-${(index % 3) + 1}`}
    >
      <div className="cover-image">
        <PhotoImage
          photo={cover}
          loading={index === 0 ? "eager" : "lazy"}
          fetchPriority={index === 0 ? "high" : "auto"}
          sizes={
            index % 3 === 1
              ? "(max-width: 767px) calc((100vw - 44px) * 0.8), (max-width: 1199px) 36vw, (min-width: 1778px) 450px, 30vw"
              : "(max-width: 767px) calc(100vw - 44px), (min-width: 1778px) 960px, 60vw"
          }
        />
      </div>
      <div className="cover-caption">
        <div>
          {project.subtitle && (
            <span className="eyebrow">{project.subtitle}</span>
          )}
          <h3>{project.title}</h3>
        </div>
        <Arrow />
      </div>
    </Link>
  );
}
